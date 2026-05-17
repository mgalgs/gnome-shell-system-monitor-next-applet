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

import GLib from "gi://GLib";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { sm_log } from './utils.js';
import { migrateSettings } from './migration.js';
import { color_from_string, smStyleManager, build_menu_info } from './base.js';
import { smMountsMonitor, Bar, Pie } from './mounts.js';
import { Battery } from './widgets/battery.js';
import { createCpus } from './widgets/cpu.js';
import { Disk } from './widgets/disk.js';
import { Fan } from './widgets/fan.js';
import { Freq } from './widgets/frequency.js';
import { Gpu } from './widgets/gpu.js';
import { Icon } from './widgets/icon.js';
import { Mem } from './widgets/memory.js';
import { Net } from './widgets/network.js';
import { Swap } from './widgets/swap.js';
import { Thermal } from './widgets/thermal.js';

const PANEL_ICON_SIZE = 16;

function change_usage(extension) {
    let usage = extension._Schema.get_string('disk-usage-style');
    extension.__sm.pie.show(usage === 'pie');
    extension.__sm.bar.show(usage === 'bar');
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
        this._Schema.connect('changed::disk-usage-style', () => change_usage(this));

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
