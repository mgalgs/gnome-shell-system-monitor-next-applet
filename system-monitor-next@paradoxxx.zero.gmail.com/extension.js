/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// system-monitor: Gnome shell extension displaying system informations in gnome shell status bar, such as memory usage, cpu usage, network rates…
// Copyright (C) 2011 Florian Mounier aka paradoxxxzero

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Author: Florian Mounier aka paradoxxxzero

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

import Gio from "gi://Gio";
import Shell from "gi://Shell";
import St from "gi://St";
import UPowerGlib from "gi://UPowerGlib";
import GTop from "gi://GTop";
import NM from "gi://NM";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { sm_log } from './utils.js';
import { parse_bytearray, check_sensors } from './common.js';
import { migrateSettings } from './migration.js';
import {
    color_from_string, try_read_int_file,
    smStyleManager, ElementBase, build_menu_info,
} from './base.js';
import { smMountsMonitor, Bar, Pie } from './mounts.js';

const NetworkManager = NM;
const UPower = UPowerGlib;
// Copied as of https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/5fa08fe53376f5dca755360bd005a4a51ca78917/js/ui/panel.js#L45
const PANEL_ICON_SIZE = 16;

function change_usage(extension) {
    let usage = extension._Schema.get_string('disk-usage-style');
    extension.__sm.pie.show(usage === 'pie');
    extension.__sm.bar.show(usage === 'bar');
}

const Battery = class SystemMonitor_Battery extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'battery',
            elt_short: 'batt',
            item_name: _('Battery'),
            color_name: ['batt0'],
            icon: '. GThemedIcon battery-good-symbolic battery-good'
        });

        this.max = 100;
        this.icon_hidden = false;
        this.percentage = 0;
        this.timeString = '-- ';

        // Battery updates are event driven, and require the following _proxy value to exist.
        //   this._proxy = Main.panel.statusArea.quickSettings._system._systemItem._powerToggle._proxy;
        // This does not exist at launch time, so start a GLib handler to poll for it
        this._poll_attempts = 0;
        this._max_poll_attempts = 9;
        this._poll_handler_id = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 1, this._poll_quickSettings.bind(this)
        );

        // need to specify a default icon, since the contructor completes before UPower callback
        this.gicon = Gio.icon_new_for_string(this.icon);

        this.tip_format('%');

        this.update_tips();
        // this.hide_system_icon();

        // Schema.connect('changed::' + this.elt + '-hidesystem', this.hide_system_icon.bind(this));
        extension._Schema.connect('changed::' + this.elt + '-time', this.update_tips.bind(this));
    }
    refresh() {
        // do nothing here?
    }
    _poll_quickSettings() {
        // check if the quickSettings proxy value is defined
        // once it is, set this._proxy and remove the handler

        if (this._proxy) {
            return GLib.SOURCE_REMOVE;
        }

        try {
            const proxy = (
                Main.panel
                ?.statusArea
                ?.quickSettings
                ?._system
                ?._systemItem
                ?._powerToggle
                ?._proxy
            );

            sm_log(`Looking for battery proxy (attempt ${this._poll_attempts})`);
            if (proxy) {
                // set this._proxy, bind update_battery(), and stop polling
                sm_log("Battery proxy found!");
                this._proxy = proxy;
                this.powerSigID = this._proxy.connect(
                    'g-properties-changed',
                    this.update_battery.bind(this),
                );
                this._poll_handler_id = undefined;
                this._poll_attempts = 0;
                return GLib.SOURCE_REMOVE;
            }
        } catch (error) {
            sm_log(`Error accessing quickSettings proxy: ${error.message}`, 'warn');
        }

        // Check if we've exceeded maximum attempts
        this._poll_attempts++;
        if (this._poll_attempts >= this._max_poll_attempts) {
            sm_log(`Battery proxy not found after ${this._poll_attempts}, giving up`);
            this._poll_handler_id = undefined;
            return GLib.SOURCE_REMOVE;
        }

        // Exponential backoff
        const next_delay = Math.pow(2, this._poll_attempts - 1);
        this._poll_handler_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, next_delay, this._poll_quickSettings.bind(this));
        return GLib.SOURCE_REMOVE;
    }
    update_battery() {
        // callback function for when battery stats updated.
        let battery_found = false;
        let isBattery = false;
        if (typeof (this._proxy.GetDevicesRemote) === 'undefined') {
            let device_type = this._proxy.Type;
            isBattery = (device_type === UPower.DeviceKind.BATTERY);
            if (isBattery) {
                battery_found = true;
                let icon = this._proxy.IconName;
                let percentage = this._proxy.Percentage;
                let seconds = this._proxy.TimeToEmpty;
                this.update_battery_value(seconds, percentage, icon);
            } else {
                // log("[System monitor] No battery found");
                this.actor.hide();
                this.menu_visible = false;
                build_menu_info(this.extension);
            }
        } else {
            this._proxy.GetDevicesRemote((devices, error) => {
                if (error) {
                    sm_log('Power proxy error: ' + error, 'error');
                    this.actor.hide();
                    this.menu_visible = false;
                    build_menu_info(this.extension);
                    return;
                }

                let [result] = devices;
                for (let i = 0; i < result.length; i++) {
                    let [device_id, device_type, icon, percentage, state, seconds] = result[i];

                    isBattery = (device_type === UPower.DeviceKind.BATTERY);
                    if (isBattery) {
                        battery_found = true;
                        this.update_battery_value(seconds, percentage, icon);
                        break;
                    }
                }

                if (!battery_found) {
                    // log("[System monitor] No battery found");
                    this.actor.hide();
                    this.menu_visible = false;
                    build_menu_info(this.extension);
                }
            });
        }
    }
    update_battery_value(seconds, percentage, icon) {
        if (seconds > 60) {
            let time = Math.round(seconds / 60);
            let minutes = time % 60;
            let hours = Math.floor(time / 60);
            this.timeString = C_('battery time remaining', '%d:%02d').format(hours, minutes);
        } else {
            this.timeString = '-- ';
        }
        this.percentage = Math.ceil(percentage);
        this.gicon = Gio.icon_new_for_string(icon);

        if (this.extension._Schema.get_boolean(this.elt + '-display')) {
            this.actor.show()
        }
        if (this.extension._Schema.get_boolean(this.elt + '-show-menu') && !this.menu_visible) {
            this.menu_visible = true;
            build_menu_info(this.extension);
        }
    }
    hide_system_icon(override) {
        let value = this.extension._Schema.get_boolean(this.elt + '-hidesystem');
        if (!override) {
            value = false;
        }
        if (value && this.extension._Schema.get_boolean(this.elt + '-display')) {
            const StatusArea = Main.panel.statusArea;
            if (StatusArea.battery.actor.visible) {
                StatusArea.battery.destroy();
                this.icon_hidden = true;
            }
        } else if (this.icon_hidden) {
            // TODO: Figure out what to put here instead
            // (git blame for more info)
            // let Indicator = new Panel.PANEL_ITEM_IMPLEMENTATIONS.battery();
            // Main.panel.addToStatusArea('battery', Indicator, Main.sessionMode.panel.right.indexOf('battery'), 'right');
            this.icon_hidden = false;
            // Main.panel._updatePanel('right');
        }
    }
    get_battery_unit() {
        let unitString;
        let value = this.extension._Schema.get_boolean(this.elt + '-time');

        if (value) {
            unitString = 'h';
        } else {
            unitString = '%';
        }

        return unitString;
    }
    update_tips() {
        let unitString = this.get_battery_unit();

        if (this.extension._Schema.get_boolean(this.elt + '-display')) {
            this.text_items[2].text = unitString;
        }
        if (this.extension._Schema.get_boolean(this.elt + '-show-menu')) {
            this.menu_items[1].text = unitString;
        }

        this.update();
    }
    _apply() {
        let displayString;
        let value = this.extension._Schema.get_boolean(this.elt + '-time');
        if (value) {
            displayString = this.timeString;
        } else {
            displayString = this.percentage.toString()
        }
        if (this.extension._Schema.get_boolean(this.elt + '-display')) {
            this.text_items[0].gicon = this.gicon;
            this.text_items[1].text = displayString;
        }
        if (this.extension._Schema.get_boolean(this.elt + '-show-menu')) {
            this.menu_items[0].text = displayString;
        }
        this.vals = [this.percentage];
        this.tip_vals[0] = Math.round(this.percentage);
    }
    create_text_items() {
        return [
            new St.Icon({
                gicon: Gio.icon_new_for_string(this.icon),
                style_class: this.extension._Style.get('sm-status-icon')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: this.get_battery_unit(),
                style_class: this.extension._Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: this.get_battery_unit(),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
    destroy() {
        ElementBase.prototype.destroy.call(this);

        if (this._proxy) {
            this._proxy.disconnect(this.powerSigID);
        }

        if (this._poll_handler_id) {
            GLib.source_remove(this._poll_handler_id);
            this._poll_handler_id = undefined;
        }
    }
}

const Cpu = class SystemMonitor_Cpu extends ElementBase {
    constructor(extension, cpuid) {
        super(extension, {
            elt: 'cpu',
            item_name: _('CPU'),
            color_name: ['user', 'system', 'nice', 'iowait', 'other'],
            cpuid: -1 // cpuid is -1 when all cores are displayed in the same graph
        });
        this.max = 100;

        this.cpuid = cpuid;
        this.gtop = new GTop.glibtop_cpu();
        this.last = [0, 0, 0, 0, 0];
        this.current = [0, 0, 0, 0, 0];
        try {
            this.total_cores = GTop.glibtop_get_sysinfo().ncpu;
            if (cpuid === -1) {
                this.max *= this.total_cores;
            }
        } catch (e) {
            this.total_cores = this.get_cores();
            console.error(e)
        }
        this.last_total = 0;
        this.usage = [0, 0, 0, 1, 0];
        this.item_name = _('Cpu');
        if (cpuid !== -1) {
            this.item_name += ' ' + (cpuid + 1);
        } // append cpu number to cpu name in popup
        // ElementBase.prototype._init.call(this);
        this.tip_format();
        this.update();
    }
    refresh() {
        GTop.glibtop_get_cpu(this.gtop);
        // display global cpu usage on 1 graph
        if (this.cpuid === -1) {
            this.current[0] = this.gtop.user;
            this.current[1] = this.gtop.sys;
            this.current[2] = this.gtop.nice;
            this.current[3] = this.gtop.idle;
            this.current[4] = this.gtop.iowait;
            let delta = (this.gtop.total - this.last_total) / (100 * this.total_cores);

            if (delta > 0) {
                for (let i = 0; i < 5; i++) {
                    this.usage[i] = Math.round((this.current[i] - this.last[i]) / delta);
                    this.last[i] = this.current[i];
                }
                this.last_total = this.gtop.total;
            } else if (delta < 0) {
                this.last = [0, 0, 0, 0, 0];
                this.current = [0, 0, 0, 0, 0];
                this.last_total = 0;
                this.usage = [0, 0, 0, 1, 0];
            }
        } else {
            // display per cpu data
            this.current[0] = this.gtop.xcpu_user[this.cpuid];
            this.current[1] = this.gtop.xcpu_sys[this.cpuid];
            this.current[2] = this.gtop.xcpu_nice[this.cpuid];
            this.current[3] = this.gtop.xcpu_idle[this.cpuid];
            this.current[4] = this.gtop.xcpu_iowait[this.cpuid];
            let delta = (this.gtop.xcpu_total[this.cpuid] - this.last_total) / 100;

            if (delta > 0) {
                for (let i = 0; i < 5; i++) {
                    this.usage[i] = Math.round((this.current[i] - this.last[i]) / delta);
                    this.last[i] = this.current[i];
                }
                this.last_total = this.gtop.xcpu_total[this.cpuid];
            } else if (delta < 0) {
                this.last = [0, 0, 0, 0, 0];
                this.current = [0, 0, 0, 0, 0];
                this.last_total = 0;
                this.usage = [0, 0, 0, 1, 0];
            }
        }

        // GTop.glibtop_get_cpu(this.gtop);
        // // display global cpu usage on 1 graph
        // if (this.cpuid == -1) {
        //     this.current[0] = this.gtop.user;
        //     this.current[1] = this.gtop.sys;
        //     this.current[2] = this.gtop.nice;
        //     this.current[3] = this.gtop.idle;
        //     this.current[4] = this.gtop.iowait;
        // } else {
        //     // display cpu usage for given core
        //     this.current[0] = this.gtop.xcpu_user[this.cpuid];
        //     this.current[1] = this.gtop.xcpu_sys[this.cpuid];
        //     this.current[2] = this.gtop.xcpu_nice[this.cpuid];
        //     this.current[3] = this.gtop.xcpu_idle[this.cpuid];
        //     this.current[4] = this.gtop.xcpu_iowait[this.cpuid];
        // }
        //
        // let delta = 0;
        // if (this.cpuid == -1)
        //     delta = (this.gtop.total - this.last_total)/(100*this.total_cores);
        // else
        //     delta = (this.gtop.xcpu_total[this.cpuid] - this.last_total)/100;
        //
        // if (delta > 0) {
        //     for (let i = 0;i < 5;i++) {
        //         this.usage[i] = Math.round((this.current[i] - this.last[i])/delta);
        //         this.last[i] = this.current[i];
        //     }
        //     if (this.cpuid == -1)
        //         this.last_total = this.gtop.total;
        //     else
        //         this.last_total = this.gtop.xcpu_total[this.cpuid];
        // }
    }
    _apply() {
        let percent = 0;
        if (this.cpuid === -1) {
            percent = Math.round(((100 * this.total_cores) - this.usage[3]) /
                                 this.total_cores);
        } else {
            percent = Math.round((100 - this.usage[3]));
        }

        this.text_items[0].text = this.menu_items[0].text = percent.toString();
        let other = 100;
        for (let i = 0; i < this.usage.length; i++) {
            other -= this.usage[i];
        }
        // Not to be confusing
        other = Math.max(0, other);
        this.vals = [this.usage[0], this.usage[1],
            this.usage[2], this.usage[4], other];
        for (let i = 0; i < 5; i++) {
            this.tip_vals[i] = Math.round(this.vals[i]);
        }
    }

    get_cores() {
        // Getting xcpu_total makes gjs 1.29.18 segfault
        // let cores = 0;
        // GTop.glibtop_get_cpu(this.gtop);
        // let gtop_total = this.gtop.xcpu_total
        // for (let i = 0; i < gtop_total.length;i++) {
        //     if (gtop_total[i] > 0)
        //         cores++;
        // }
        // return cores;
        return 1;
    }
    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: '%', style_class: this.extension._Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: '%',
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

// Check if one graph per core must be displayed and create the
//    appropriate number of cpu items
function createCpus(extension) {
    let array = [];
    let numcores = 1;

    if (extension._Schema.get_boolean('cpu-individual-cores')) {
        // get number of cores
        let gtop = new GTop.glibtop_cpu();
        try {
            numcores = GTop.glibtop_get_sysinfo().ncpu;
        } catch (e) {
            console.error(e);
            numcores = 1;
        }
    }

    // there are several cores to display,
    // instantiate each cpu
    if (numcores > 1) {
        for (let i = 0; i < numcores; i++) {
            array.push(new Cpu(extension, i));
        }
    } else {
        // individual cores option is not set or we failed to
        // get the number of cores, create a global cpu item
        array.push(new Cpu(extension, -1));
    }

    return array;
}

const Disk = class SystemMonitor_Disk extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'disk',
            item_name: _('Disk'),
            color_name: ['read', 'write']
        });
        this.mounts = extension._MountsMonitor.get_mounts();
        extension._MountsMonitor.add_listener(this.update_mounts.bind(this));
        this.last = [0, 0];
        this.usage = [0, 0];
        this.last_time = 0;
        this.tip_format(_('MiB/s'));
        this.update();
    }
    update_mounts(mounts) {
        this.mounts = mounts;
    }
    refresh() {
        let accum = [0, 0];

        let file = Gio.file_new_for_path('/proc/diskstats');
        file.load_contents_async(null, (source, result) => {
            let as_r = source.load_contents_finish(result);
            let lines = parse_bytearray(as_r[1]).toString().split('\n');

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i];
                let entry = line.trim().split(/[\s]+/);
                if (typeof (entry[1]) === 'undefined') {
                    break;
                }
                accum[0] += parseInt(entry[5]);
                accum[1] += parseInt(entry[9]);
            }

            let time = GLib.get_monotonic_time() / 1000;
            let delta = (time - this.last_time) / 1000;
            if (delta > 0) {
                for (let i = 0; i < 2; i++) {
                    this.usage[i] = ((accum[i] - this.last[i]) / delta / 1024 / 8);
                    this.last[i] = accum[i];
                }
            }
            this.last_time = time;
        });
    }
    _apply() {
        this.vals = this.usage.slice();
        for (let i = 0; i < 2; i++) {
            if (this.usage[i] < 10) {
                this.usage[i] = Math.round(10 * this.usage[i]) / 10;
            } else {
                this.usage[i] = Math.round(this.usage[i]);
            }
        }
        this.tip_vals = [this.usage[0], this.usage[1]];
        this.menu_items[0].text = this.text_items[1].text = this.tip_vals[0].toLocaleString(this.extension._Locale);
        this.menu_items[3].text = this.text_items[4].text = this.tip_vals[1].toLocaleString(this.extension._Locale);
    }
    create_text_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({
                text: _('R'),
                style_class: Style.get('sm-status-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-disk-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: Style.diskunits(),
                style_class: Style.get('sm-disk-unit-label'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: _('W'),
                style_class: Style.get('sm-status-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-disk-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: Style.diskunits(),
                style_class: Style.get('sm-disk-unit-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: Style.diskunits(),
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: ' ' + _('R'),
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: Style.diskunits(),
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: ' ' + _('W'),
                style_class: Style.get('sm-label')})
        ];
    }
}

const Freq = class SystemMonitor_Freq extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'freq',
            item_name: _('Freq'),
            color_name: ['freq']
        });
        this.freq = 0;
        this.tip_format('MHz');

        extension._Schema.connect('changed::freq-display-mode', this.update.bind(this));

        this.update();
    }
    refresh() {
        let total_frequency = 0;
        let max_frequency = 0;
        let num_cpus = GTop.glibtop_get_sysinfo().ncpu;
        let i = 0;
        let file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
        let that = this;
        let display_mode = this.extension._Schema.get_enum('freq-display-mode');

        file.load_contents_async(null, function cb(source, result) {
            let as_r = source.load_contents_finish(result);
            let current_freq = parseInt(parse_bytearray(as_r[1]));

            total_frequency += current_freq;
            max_frequency = Math.max(max_frequency, current_freq);

            if (++i >= num_cpus) {
                if (display_mode === 0) { // 'max' mode
                    that.freq = Math.round(max_frequency / 1000);
                } else { // 'average' mode
                    that.freq = Math.round(total_frequency / num_cpus / 1000);
                }
            } else {
                file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
                file.load_contents_async(null, cb.bind(that));
            }
        });
    }
    _apply() {
        let value = this.freq.toString();
        this.text_items[0].text = value + ' ';
        this.vals[0] = value;
        this.tip_vals[0] = value;
        if (this.extension._Style.get('') !== '-compact') {
            this.menu_items[0].text = value;
        } else {
            this.menu_items[0].text = this._pad(value, 4);
        }
    }
    // pad a string with leading spaces
    _pad(number, length) {
        let str = '' + number;
        while (str.length < length) {
            str = ' ' + str;
        }
        return str;
    }
    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-big-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: 'MHz', style_class: this.extension._Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: 'MHz',
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

const Mem = class SystemMonitor_Mem extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'memory',
            elt_short: 'mem',
            item_name: _('Memory'),
            color_name: ['program', 'buffer', 'cache']
        });
        this.max = 1;

        this.gtop = new GTop.glibtop_mem();
        this.mem = [0, 0, 0];

        GTop.glibtop_get_mem(this.gtop);
        this.total = Math.round(this.gtop.total / 1024 / 1024);
        let threshold = 4 * 1024; // In MiB
        this.useGiB = false;
        this._unitConversion = 1024 * 1024;
        this._decimals = 100;
        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;
        }

        this.tip_format();
        this.update();
    }
    refresh() {
        GTop.glibtop_get_mem(this.gtop);
        if (this.useGiB) {
            this.mem[0] = Math.round(this.gtop.user / this._unitConversion);
            this.mem[0] /= this._decimals;
            this.mem[1] = Math.round(this.gtop.buffer / this._unitConversion);
            this.mem[1] /= this._decimals;
            this.mem[2] = Math.round(this.gtop.cached / this._unitConversion);
            this.mem[2] /= this._decimals;
            this.total = Math.round(this.gtop.total / this._unitConversion);
            this.total /= this._decimals;
        } else {
            this.mem[0] = Math.round(this.gtop.user / this._unitConversion);
            this.mem[1] = Math.round(this.gtop.buffer / this._unitConversion);
            this.mem[2] = Math.round(this.gtop.cached / this._unitConversion);
            this.total = Math.round(this.gtop.total / this._unitConversion);
        }
    }
    _pad(number) {
        const Locale = this.extension._Locale;
        if (this.useGiB) {
            if (number < 1) {
                // examples: 0.01, 0.10, 0.88
                return number.toLocaleString(Locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            // examples: 5.85, 16.0, 128
            return number.toLocaleString(Locale, {minimumSignificantDigits: 3, maximumSignificantDigits: 3});
        }

        return number.toLocaleString(Locale);
    }
    _apply() {
        if (this.total === 0) {
            this.vals = this.tip_vals = [0, 0, 0];
        } else {
            for (let i = 0; i < 3; i++) {
                this.vals[i] = this.mem[i] / this.total;
                this.tip_vals[i] = Math.round(this.vals[i] * 100);
            }
        }
        this.text_items[0].text = this.tip_vals[0].toString();
        this.menu_items[0].text = this.tip_vals[0].toLocaleString(this.extension._Locale);
        if (this.extension._Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(this.mem[0]) +
                ' / ' + this._pad(this.total);
        } else {
            this.menu_items[3].text = this._pad(this.mem[0]) +
                '/' + this._pad(this.total);
        }
    }
    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: '%', style_class: this.extension._Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        let unit = _('MiB');
        if (this.useGiB) {
            unit = _('GiB');
        }
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: '%',
                style_class: this.extension._Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({text: unit,
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

const Net = class SystemMonitor_Net extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'net',
            item_name: _('Net'),
            color_name: ['down', 'downerrors', 'up', 'uperrors', 'collisions']
        });
        this.speed_in_bits = false;
        this.ifs = [];
        this.client = NM.Client.new(null);
        this.update_iface_list();

        if (!this.ifs.length) {
            try {
                let [, net_contents] = Gio.File.new_for_path('/proc/net/dev').load_contents(null);
                let net_lines = new TextDecoder().decode(net_contents).split('\n');
                for (let i = 2; i < net_lines.length - 1; i++) {
                    let ifc = net_lines[i].replace(/^\s+/g, '').split(':')[0];
                    try {
                        let [, op_contents] = Gio.File.new_for_path(
                            '/sys/class/net/' + ifc + '/operstate').load_contents(null);
                        if (new TextDecoder().decode(op_contents).replace(/\s/g, '') === 'up' &&
                            ifc.indexOf('br') < 0 &&
                            ifc.indexOf('lo') < 0) {
                            this.ifs.push(ifc);
                        }
                    } catch (_e) { /* operstate file may not exist */ }
                }
            } catch (_e) { /* /proc/net/dev unavailable */ }
        }
        this.gtop = new GTop.glibtop_netload();
        this.last = [0, 0, 0, 0, 0];
        this.usage = [0, 0, 0, 0, 0];
        this.last_time = 0;
        this.tip_format([_('KiB/s'), '/s', _('KiB/s'), '/s', '/s']);
        this.update_units();
        this.extension._Schema.connect('changed::' + this.elt + '-speed-in-bits', this.update_units.bind(this));
        try {
            let iface_list = this.client.get_devices();
            this.NMsigID = [];
            for (let j = 0; j < iface_list.length; j++) {
                this.NMsigID[j] = iface_list[j].connect('state-changed', this.update_iface_list.bind(this));
            }
        } catch (e) {
            console.error('Please install Network Manager Gobject Introspection Bindings: ' + e);
        }
        this.update();
    }
    update_units() {
        this.speed_in_bits = this.extension._Schema.get_boolean(this.elt + '-speed-in-bits');
    }
    update_iface_list() {
        try {
            this.ifs = [];
            let iface_list = this.client.get_devices();
            for (let j = 0; j < iface_list.length; j++) {
                if (iface_list[j].state === NetworkManager.DeviceState.ACTIVATED) {
                    this.ifs.push(iface_list[j].get_ip_iface() || iface_list[j].get_iface());
                }
            }
        } catch (e) {
            console.error('Please install Network Manager Gobject Introspection Bindings');
        }
    }
    refresh() {
        let accum = [0, 0, 0, 0, 0];

        for (let ifn in this.ifs) {
            GTop.glibtop_get_netload(this.gtop, this.ifs[ifn]);
            accum[0] += this.gtop.bytes_in;
            accum[1] += this.gtop.errors_in;
            accum[2] += this.gtop.bytes_out;
            accum[3] += this.gtop.errors_out;
            accum[4] += this.gtop.collisions;
        }

        let time = GLib.get_monotonic_time() * 0.001024;
        let delta = time - this.last_time;
        if (delta > 0) {
            for (let i = 0; i < 5; i++) {
                this.usage[i] = Math.round((accum[i] - this.last[i]) / delta);
                this.last[i] = accum[i];
                this.vals[i] = this.usage[i];
            }
        }
        this.last_time = time;
    }

    // pad a string with leading spaces
    _pad(number, length) {
        let str = '' + number;
        while (str.length < length) {
            str = ' ' + str;
        }
        return str;
    }

    _apply() {
        const Style = this.extension._Style;
        this.tip_vals = this.usage;
        if (this.speed_in_bits) {
            this.tip_vals[0] = Math.round(this.tip_vals[0] * 8.192);
            this.tip_vals[2] = Math.round(this.tip_vals[2] * 8.192);
            if (this.tip_vals[0] < 1000) {
                this.text_items[2].text = Style.netunits_kbits();
                this.menu_items[1].text = this.tip_unit_labels[0].text = _('kbit/s');
            } else if (this.tip_vals[0] < 1000000) {
                this.text_items[2].text = Style.netunits_mbits();
                this.menu_items[1].text = this.tip_unit_labels[0].text = _('Mbit/s');
                this.tip_vals[0] = (this.tip_vals[0] / 1000).toPrecision(3);
            } else {
                this.text_items[2].text = Style.netunits_gbits();
                this.menu_items[1].text = this.tip_unit_labels[0].text = _('Gbit/s');
                this.tip_vals[0] = (this.tip_vals[0] / 1000000).toPrecision(3);
            }
            if (this.tip_vals[2] < 1000) {
                this.text_items[5].text = Style.netunits_kbits();
                this.menu_items[4].text = this.tip_unit_labels[2].text = _('kbit/s');
            } else if (this.tip_vals[2] < 1000000) {
                this.text_items[5].text = Style.netunits_mbits();
                this.menu_items[4].text = this.tip_unit_labels[2].text = _('Mbit/s');
                this.tip_vals[2] = (this.tip_vals[2] / 1000).toPrecision(3);
            } else {
                this.text_items[5].text = Style.netunits_gbits();
                this.menu_items[4].text = this.tip_unit_labels[2].text = _('Gbit/s');
                this.tip_vals[2] = (this.tip_vals[2] / 1000000).toPrecision(3);
            }
        } else {
            if (this.tip_vals[0] < 1024) {
                this.text_items[2].text = Style.netunits_kbytes();
                this.menu_items[1].text = this.tip_unit_labels[0].text = _('KiB/s');
            } else if (this.tip_vals[0] < 1048576) {
                this.text_items[2].text = Style.netunits_mbytes();
                this.menu_items[1].text = this.tip_unit_labels[0].text = _('MiB/s');
                this.tip_vals[0] = (this.tip_vals[0] / 1024).toPrecision(3);
            } else {
                this.text_items[2].text = Style.netunits_gbytes();
                this.menu_items[1].text = this.tip_unit_labels[0].text = _('GiB/s');
                this.tip_vals[0] = (this.tip_vals[0] / 1048576).toPrecision(3);
            }
            if (this.tip_vals[2] < 1024) {
                this.text_items[5].text = Style.netunits_kbytes();
                this.menu_items[4].text = this.tip_unit_labels[2].text = _('KiB/s');
            } else if (this.tip_vals[2] < 1048576) {
                this.text_items[5].text = Style.netunits_mbytes();
                this.menu_items[4].text = this.tip_unit_labels[2].text = _('MiB/s');
                this.tip_vals[2] = (this.tip_vals[2] / 1024).toPrecision(3);
            } else {
                this.text_items[5].text = Style.netunits_gbytes();
                this.menu_items[4].text = this.tip_unit_labels[2].text = _('GiB/s');
                this.tip_vals[2] = (this.tip_vals[2] / 1048576).toPrecision(3);
            }
        }

        if (Style.get('') !== '-compact') {
            this.menu_items[0].text = this.text_items[1].text = this.tip_vals[0].toString();
            this.menu_items[3].text = this.text_items[4].text = this.tip_vals[2].toString();
        } else {
            this.menu_items[0].text = this.text_items[1].text = this._pad(this.tip_vals[0].toString(), 4);
            this.menu_items[3].text = this.text_items[4].text = this._pad(this.tip_vals[2].toString(), 4);
        }
    }
    create_text_items() {
        const Style = this.extension._Style;
        const IconSize = this.extension._IconSize;
        return [
            new St.Icon({
                icon_size: 2 * IconSize / 3 * Style.iconsize(),
                icon_name: 'go-down-symbolic'}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-net-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: _('KiB/s'),
                style_class: Style.get('sm-net-unit-label'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Icon({
                icon_size: 2 * IconSize / 3 * Style.iconsize(),
                icon_name: 'go-up-symbolic'}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-net-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: _('KiB/s'),
                style_class: Style.get('sm-net-unit-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: _('KiB/s'),
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: _(' ↓'),
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: _(' KiB/s'),
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: _(' ↑'),
                style_class: Style.get('sm-label')})
        ];
    }
}

const Swap = class SystemMonitor_Swap extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'swap',
            item_name: _('Swap'),
            color_name: ['used']
        });
        this.max = 1;
        this.gtop = new GTop.glibtop_swap();

        GTop.glibtop_get_swap(this.gtop);
        this.total = Math.round(this.gtop.total / 1024 / 1024);
        let threshold = 4 * 1024; // In MiB
        this.useGiB = false;
        this._unitConversion = 1024 * 1024;
        this._decimals = 100;
        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;
        }

        this.tip_format();
        this.update();
    }
    refresh() {
        GTop.glibtop_get_swap(this.gtop);
        if (this.useGiB) {
            this.swap = Math.round(this.gtop.used / this._unitConversion);
            this.swap /= this._decimals;
            this.total = Math.round(this.gtop.total / this._unitConversion);
            this.total /= this._decimals;
        } else {
            this.swap = Math.round(this.gtop.used / this._unitConversion);
            this.total = Math.round(this.gtop.total / this._unitConversion);
        }
    }
    _pad(number) {
        if (this.useGiB) {
            if (number < 1) {
                // examples: 0.01, 0.10, 0.88
                return number.toLocaleString(this.extension._Locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            // examples: 5.85, 16.0, 128
            return number.toLocaleString(this.extension._Locale, {minimumSignificantDigits: 3, maximumSignificantDigits: 3});
        }

        return number.toLocaleString(this.extension._Locale);
    }
    _apply() {
        if (this.total === 0) {
            this.vals = this.tip_vals = [0];
        } else {
            this.vals[0] = this.swap / this.total;
            this.tip_vals[0] = Math.round(this.vals[0] * 100);
        }
        this.text_items[0].text = this.tip_vals[0].toString();
        this.menu_items[0].text = this.tip_vals[0].toString();
        if (this.extension._Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(this.swap) +
                ' / ' + this._pad(this.total);
        } else {
            this.menu_items[3].text = this._pad(this.swap) +
                '/' + this._pad(this.total);
        }
    }

    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: '%',
                style_class: this.extension._Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        let unit = 'MiB';
        if (this.useGiB) {
            unit = 'GiB';
        }
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: '%',
                style_class: this.extension._Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: _(unit),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

const Thermal = class SystemMonitor_Thermal extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'thermal',
            elt_short: 'thrm',
            item_name: _('Thermal'),
            color_name: ['tz0']
        });
        this.max = 100;
        this.sensors = check_sensors("temp");

        this.item_name = _('Thermal');
        this.temperature = '-- ';
        this.fahrenheit_unit = extension._Schema.get_boolean(this.elt + '-fahrenheit-unit');
        this.display_error = true;
        this.tip_format(this.temperature_symbol());
        extension._Schema.connect('changed::' + this.elt + '-sensor-label', this.refresh.bind(this));
        this.update();
    }
    refresh() {
        if (this.sensors === undefined || Object.keys(this.sensors).length === 0) {
            return;
        }
        let label = this.extension._Schema.get_string(this.elt + '-sensor-label');
        let sfile = this.sensors[label];
        if (sfile === undefined && this.display_error) {
            const validLabels = Object.keys(this.sensors).join(', ');
            sm_log(`Invalid thermal sensor label: "${label}" (valid choices: ${validLabels})`, 'error');
            this.display_error = false;
            return;
        }
        if (!try_read_int_file(sfile, value => this.temperature = Math.round(value / 1000)) && this.display_error) {
            sm_log(`Error reading thermal sensor file: ${sfile}`, 'error');
            this.display_error = false;
        }

        this.fahrenheit_unit = this.extension._Schema.get_boolean(this.elt + '-fahrenheit-unit');
    }
    _apply() {
        this.text_items[0].text = this.menu_items[0].text = this.temperature_text();
        this.temp_over_threshold = this.temperature > this.extension._Schema.get_int('thermal-threshold');
        this.vals = [this.temperature];
        this.tip_vals[0] = this.temperature_text();
        this.text_items[1].text = this.menu_items[1].text = this.temperature_symbol();
        this.tip_unit_labels[0].text = _(this.temperature_symbol());
    }
    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: this.temperature_symbol(),
                style_class: this.extension._Style.get('sm-temp-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: this.temperature_symbol(),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
    temperature_text() {
        let temperature = this.temperature;
        if (this.fahrenheit_unit) {
            temperature = Math.round(temperature * 1.8 + 32);
        }
        return temperature.toString();
    }
    temperature_symbol() {
        return this.fahrenheit_unit ? '°F' : '°C';
    }
}

const Fan = class SystemMonitor_Fan extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'fan',
            item_name: _('Fan'),
            color_name: ['fan0']
        });
        this.sensors = check_sensors("fan");
        this.rpm = 0;
        this.display_error = true;
        this.tip_format(_('rpm'));
        extension._Schema.connect('changed::' + this.elt + '-sensor-label', this.refresh.bind(this));
        this.update();
    }
    refresh() {
        if (this.sensors === undefined || Object.keys(this.sensors).length === 0) {
            return;
        }
        let label = this.extension._Schema.get_string(this.elt + '-sensor-label');
        let sfile = this.sensors[label];
        if (sfile === undefined && this.display_error) {
            const validLabels = Object.keys(this.sensors).join(', ');
            sm_log(`Invalid fan sensor label: "${label}" (valid choices: ${validLabels})`, 'error');
            this.display_error = false;
            return;
        }
        if (!try_read_int_file(sfile, value => this.rpm = value) && this.display_error) {
            sm_log(`Error reading fan sensor file: ${sfile}`, 'error');
            this.display_error = false;
        }
        if (sfile) {
            try_read_int_file(sfile.replace(/_input$/, '_min'), value => this.min = value);
            try_read_int_file(sfile.replace(/_input$/, '_max'), value => this.max = value);
        }
    }
    _apply() {
        this.text_items[0].text = this.rpm.toString();
        this.menu_items[0].text = this.rpm.toString();
        this.vals = [this.rpm];
        this.tip_vals[0] = this.rpm;
    }
    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: _('rpm'), style_class: this.extension._Style.get('sm-unit-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: _('rpm'),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

const Gpu = class SystemMonitor_Gpu extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'gpu',
            item_name: _('GPU'),
            color_name: ['used', 'memory']
        });
        this.max = 100;

        this.item_name = _('GPU');
        this.mem = 0;
        this.total = 0;
        this.tip_format();
        this.update();
    }
    _unit(total) {
        this.total = total;
        let threshold = 4 * 1024; // In MiB
        this.useGiB = false;
        this._unitConversion = 1;
        this._decimals = 100;
        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;
        }
    }
    refresh() {
        // Run asynchronously, to avoid shell freeze
        try {
            let path = this.extension.path;
            let script = ['/usr/bin/env', 'bash', path + '/gpu_usage.sh'];

            // Create subprocess and capture STDOUT
            let proc = new Gio.Subprocess({argv: script, flags: Gio.SubprocessFlags.STDOUT_PIPE});
            proc.init(null);
            // Asynchronously call the output handler when script output is ready
            proc.communicate_utf8_async(null, null, this._handleOutput.bind(this));
        } catch (err) {
            console.error(err.message);
        }
    }
    _handleOutput(proc, result) {
        let [ok, output, ] = proc.communicate_utf8_finish(result);
        if (ok) {
            this._readTemperature(output);
        } else {
            console.error('gpu_usage.sh invocation failed');
        }
    }
    _sanitizeUsageValue(val) {
        val = parseInt(val);
        if (isNaN(val)) {
            val = 0
        }
        return val;
    }
    _readTemperature(procOutput) {
        let usage = procOutput.split('\n');
        let memTotal = this._sanitizeUsageValue(usage[0]);
        let memUsed = this._sanitizeUsageValue(usage[1]);
        this.percentage = this._sanitizeUsageValue(usage[2]);
        if (typeof this.useGiB === 'undefined') {
            this._unit(memTotal);
            this._update_unit();
        }

        if (this.useGiB) {
            this.mem = Math.round(memUsed / this._unitConversion);
            this.mem /= this._decimals;
            this.total = Math.round(memTotal / this._unitConversion);
            this.total /= this._decimals;
        } else {
            this.mem = Math.round(memUsed / this._unitConversion);
            this.total = Math.round(memTotal / this._unitConversion);
        }
    }
    _pad(number) {
        if (this.useGiB) {
            if (number < 1) {
                // examples: 0.01, 0.10, 0.88
                return number.toFixed(2);
            }
            // examples: 5.85, 16.0, 128
            return number.toPrecision(3);
        }

        return number;
    }
    _update_unit() {
        let unit = _('MiB');
        if (this.useGiB) {
            unit = _('GiB');
        }
        this.menu_items[4].text = unit;
    }
    _apply() {
        const Style = this.extension._Style;
        const Locale = this.extension._Locale;
        this.tip_unit_labels[1].text = "/ " + this.total + " " + this.menu_items[4].text;
        if (this.total === 0) {
            this.vals = [0, 0];
            this.tip_vals = [0, 0];
        } else {
            // we subtract percentage from memory because we do not want memory to be
            // "accumulated" in the chart with utilization; these two measures should be
            // independent
            this.vals = [this.percentage, this.mem / this.total * 100 - this.percentage];
            this.tip_vals = [Math.round(this.vals[0]), this.mem];
        }
        this.text_items[0].text = this.tip_vals[0].toString();
        this.menu_items[0].text = this.tip_vals[0].toLocaleString(Locale);

        if (Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(this.mem).toLocaleString(Locale) +
                '  /  ' + this._pad(this.total).toLocaleString(Locale);
        } else {
            this.menu_items[3].text = this._pad(this.mem).toLocaleString(Locale) +
                '/' + this._pad(this.total).toLocaleString(Locale);
        }
    }
    create_text_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: '%',
                style_class: Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        const Style = this.extension._Style;
        let unit = _('MiB');
        if (this.useGiB) {
            unit = _('GiB');
        }
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: '%',
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: unit,
                style_class: Style.get('sm-label')})
        ];
    }
}

const Icon = class SystemMonitor_Icon {
    constructor(extension) {
        this.extension = extension;
        this.actor = new St.Icon({
            icon_name: 'org.gnome.SystemMonitor-symbolic',
            style_class: 'system-status-icon'
        });
        this.actor.visible = this.extension._Schema.get_boolean('icon-display');
        this.extension._Schema.connect(
            'changed::icon-display',
            () => {
                this.actor.visible = this.extension._Schema.get_boolean('icon-display');
            }
        );
    }
}

export default class SystemMonitorExtension extends Extension {
    _lookupMonitorApp() {
        const monitorAppIds = [
            'org.gnome.SystemMonitor.desktop',
            'gnome-system-monitor.desktop',
            'net.nokyan.Resources.desktop',
        ];
        let _appSys = Shell.AppSystem.get_default();
        for (const id of monitorAppIds) {
            let app = _appSys.lookup_app(id);
            if (app)
                return app;
        }
        return null;
    }

    openSystemMonitor() {
        let _gsmApp = this._lookupMonitorApp();
        let customCmd = this._Schema.get_string('custom-monitor-command');

        if (!customCmd || customCmd.trim() === '') {
            if (_gsmApp)
                _gsmApp.activate();
            else
                sm_log('No system monitor application found', 'warn');
            return;
        }

        sm_log("Executing custom system monitor command: " + customCmd);
        try {
            let [success, argv] = GLib.shell_parse_argv(customCmd);
            if (!success) {
                sm_log('Failed to parse custom monitor command: ' + customCmd, 'error');
                if (_gsmApp)
                    _gsmApp.activate();
                return;
            }

            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.NONE
            });
            proc.init(null);
            proc.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                    sm_log('Custom system monitor command completed with exit code: ' + proc.get_exit_status());
                } catch (e) {
                    sm_log('Error waiting for process completion: ' + e.message, 'error');
                }
            });
        } catch (e) {
            sm_log('Failed to execute custom monitor command: ' + e.message, 'error');
            if (_gsmApp)
                _gsmApp.activate();
        }
    }

    enable() {
        sm_log('applet enable from ' + this.path);

        migrateSettings(this);

        // Get locale, needed as an argument for toLocaleString() since GNOME Shell 3.24
        // See: mozjs library bug https://bugzilla.mozilla.org/show_bug.cgi?id=999003
        this._Locale = GLib.get_language_names()[0];
        if (this._Locale.indexOf('_') !== -1) {
            this._Locale = this._Locale.split('_')[0];
        }

        // fallback to en for unsupported locale
        try {
            new Date().toLocaleString(this._Locale);
        } catch (e) {
            sm_log('fallback to EN: ' + e.message, 'warn')
            this._Locale = 'en'
        }

        this._IconSize = Math.round(PANEL_ICON_SIZE * 4 / 5);

        this._Schema = this.getSettings();

        this._Style = new smStyleManager(this);
        this._MountsMonitor = new smMountsMonitor(this);

        this._Background = color_from_string(this._Schema.get_string('background'));

        this.menuTimeout = null;

        let panel = Main.panel._rightBox;
        if (this._Schema.get_boolean('center-display')) {
            panel = Main.panel._centerBox;
        }
        else if (this._Schema.get_boolean('left-display')) {
            panel = Main.panel._leftBox;
        }

        this._MountsMonitor.connect();

        // Debug
        this.__sm = {
            tray: new PanelMenu.Button(0.5),
            icon: new Icon(this),
            pie: new Pie(this),
            bar: new Bar(this),
            elts: [],
        };

        // Items to Monitor
        let tray = this.__sm.tray;

        // Load the preferred position of the displays and insert them in said order.
        const positionList = {};
        // CPUs are inserted differently, so cpu-position is stored apart
        const cpuPosition = this._Schema.get_int('cpu-position');
        positionList[cpuPosition] = createCpus(this);
        positionList[this._Schema.get_int('freq-position')] = new Freq(this);
        positionList[this._Schema.get_int('memory-position')] = new Mem(this);
        positionList[this._Schema.get_int('swap-position')] = new Swap(this);
        positionList[this._Schema.get_int('net-position')] = new Net(this);
        positionList[this._Schema.get_int('disk-position')] = new Disk(this);
        positionList[this._Schema.get_int('gpu-position')] = new Gpu(this);
        positionList[this._Schema.get_int('thermal-position')] = new Thermal(this);
        positionList[this._Schema.get_int('fan-position')] = new Fan(this);
        // See TODO inside Battery
        positionList[this._Schema.get_int('battery-position')] = new Battery(this);

        if (this._Schema.get_boolean('move-clock')) {
            let dateMenu = Main.panel.statusArea.dateMenu;
            Main.panel._centerBox.remove_child(dateMenu.container);
            Main.panel._addToPanelBox('dateMenu', dateMenu, -1, Main.panel._rightBox);
            tray.clockMoved = true;
        }

        this._Schema.connect('changed::background', (schema, key) => {
            this._Background = color_from_string(this._Schema.get_string(key));
        });
        Main.panel._addToPanelBox('system-monitor', tray, 1, panel);

        // The spacing adds a distance between the graphs/text on the top bar
        let spacing = this._Schema.get_boolean('compact-display') ? '1' : '4';
        let box = new St.BoxLayout({style: 'spacing: ' + spacing + 'px;'});
        tray.add_child(box);
        box.add_child(this.__sm.icon.actor);

        // Need to convert the positionList object into an array
        // (sorted by object key) and then expand out the CPUs list
        const sortedPLEntries = Object.entries(positionList).sort((a, b) => a[0] - b[0]);
        const sortedPLValues = sortedPLEntries.map(([key, value]) => value);
        this.__sm.elts = sortedPLValues.flat();

        // Add items to panel box
        for (const elt of this.__sm.elts) {
            box.add_child(elt.actor);
        }

        // Build Menu Info Box Table
        let menu_info = new PopupMenu.PopupBaseMenuItem({reactive: false});
        let menu_info_box = new St.BoxLayout();
        menu_info.actor.add_child(menu_info_box);
        this.__sm.tray.menu.addMenuItem(menu_info, 0);

        build_menu_info(this);

        tray.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let pie_item = this.__sm.pie;
        pie_item.create_menu_item();
        tray.menu.addMenuItem(pie_item.menu_item);

        let bar_item = this.__sm.bar;
        bar_item.create_menu_item();
        tray.menu.addMenuItem(bar_item.menu_item);

        change_usage(this);
        this._Schema.connect('changed::disk-usage-style', change_usage);

        tray.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        tray.menu.connect(
            'open-state-changed',
            (menu, isOpen) => {
                if (isOpen) {
                    this.__sm.pie.actor.queue_repaint();

                    this.menuTimeout = GLib.timeout_add_seconds(
                        GLib.PRIORITY_DEFAULT,
                        5,
                        () => {
                            this.__sm.pie.actor.queue_repaint();
                            return GLib.SOURCE_CONTINUE;
                        });
                } else {
                    GLib.Source.remove(this.menuTimeout);
                }
            }
        );

        let item;
        let customCmd = this._Schema.get_string('custom-monitor-command');
        if (this._lookupMonitorApp() || (customCmd && customCmd.trim() !== '')) {
            item = new PopupMenu.PopupMenuItem(_('System Monitor...'));
            item.connect('activate', () => {
                this.openSystemMonitor();
            });
            tray.menu.addMenuItem(item);
        }

        item = new PopupMenu.PopupMenuItem(_('Preferences...'));
        item.connect('activate', () => {
            this.openPreferences();
        });
        tray.menu.addMenuItem(item);
        Main.panel.menuManager.addMenu(tray.menu);
    }

    disable() {
        if (this.menuTimeout) {
            GLib.Source.remove(this.menuTimeout);
            this.menuTimeout = null;
        }
        // restore clock
        if (this.__sm.tray.clockMoved) {
            let dateMenu = Main.panel.statusArea.dateMenu;
            Main.panel._rightBox.remove_child(dateMenu.container);
            Main.panel._addToPanelBox('dateMenu', dateMenu, Main.sessionMode.panel.center.indexOf('dateMenu'), Main.panel._centerBox);
        }
        // restore system power icon if necessary
        // workaround bug introduced by multiple cpus init :
        // if (Schema.get_boolean('battery-hidesystem') && this.__sm.elts.battery.icon_hidden) {
        //    this.__sm.elts.battery.hide_system_icon(false);
        // }
        // for (let i in this.__sm.elts) {
        //    if (this.__sm.elts[i].elt == 'battery')
        //        this.__sm.elts[i].hide_system_icon(false);
        // }

        if (this._MountsMonitor) {
            this._MountsMonitor.disconnect();
            this._MountsMonitor = null;
        }

        if (this._Style) {
            this._Style = null;
        }

        for (let eltName in this.__sm.elts) {
            this.__sm.elts[eltName].destroy();
        }
        this.__sm.tray.destroy();
        this.__sm = null;

        sm_log('applet disable');
    }
}
