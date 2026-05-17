/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GTop from "gi://GTop";
import NM from "gi://NM";
import St from "gi://St";
import { ElementBase } from '../base.js';

const NetworkManager = NM;

const Net = class SystemMonitor_Net extends ElementBase {
    static metadata = {
        name: 'Net',
        metrics: [
            { key: 'down', color: true },
            { key: 'downerrors', color: true },
            { key: 'up', color: true },
            { key: 'uperrors', color: true },
            { key: 'collisions', color: true },
        ],
    };

    constructor(extension, config) {
        super(extension, config);
        this.speed_in_bits = this.config['speed-in-bits'] || false;
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
                            if (this.device_id === 'all' || this.device_id === ifc)
                                this.ifs.push(ifc);
                        }
                    } catch { /* operstate file may not exist */ }
                }
            } catch { /* /proc/net/dev unavailable */ }
        }

        if (this.device_id !== 'all') {
            this.label.text = this.device_id;
            this.item_name = _('Net') + ' ' + this.device_id;
        }

        this.gtop = new GTop.glibtop_netload();
        this._last = [0, 0, 0, 0, 0];
        this._lastTime = 0;
        this.tip_format([_('KiB/s'), '/s', _('KiB/s'), '/s', '/s']);
        try {
            let iface_list = this.client.get_devices();
            this.NMsigID = [];
            for (let j = 0; j < iface_list.length; j++)
                this.NMsigID[j] = iface_list[j].connect('state-changed', this.update_iface_list.bind(this));
        } catch (e) {
            console.error('Please install Network Manager Gobject Introspection Bindings: ' + e);
        }
    }

    update_iface_list() {
        try {
            this.ifs = [];
            let iface_list = this.client.get_devices();
            for (let j = 0; j < iface_list.length; j++) {
                if (iface_list[j].state === NetworkManager.DeviceState.ACTIVATED) {
                    let iface = iface_list[j].get_ip_iface() || iface_list[j].get_iface();
                    if (this.device_id === 'all' || this.device_id === iface)
                        this.ifs.push(iface);
                }
            }
        } catch {
            console.error('Please install Network Manager Gobject Introspection Bindings');
        }
    }

    collect() {
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
        let delta = time - this._lastTime;
        let usage = [0, 0, 0, 0, 0];
        if (delta > 0) {
            for (let i = 0; i < 5; i++) {
                usage[i] = Math.round((accum[i] - this._last[i]) / delta);
                this._last[i] = accum[i];
            }
        }
        this._lastTime = time;
        return {
            down: usage[0], downerrors: usage[1],
            up: usage[2], uperrors: usage[3],
            collisions: usage[4],
        };
    }

    format(data) {
        const Style = this.extension._Style;
        let downVal = data.down;
        let upVal = data.up;

        if (this.speed_in_bits) {
            downVal = Math.round(downVal * 8.192);
            upVal = Math.round(upVal * 8.192);
            this._formatSpeed(downVal, 0, 1000,
                Style.netunits_kbits(), _('kbit/s'),
                Style.netunits_mbits(), _('Mbit/s'), 1000,
                Style.netunits_gbits(), _('Gbit/s'), 1000000);
            this._formatSpeed(upVal, 1, 1000,
                Style.netunits_kbits(), _('kbit/s'),
                Style.netunits_mbits(), _('Mbit/s'), 1000,
                Style.netunits_gbits(), _('Gbit/s'), 1000000);
        } else {
            this._formatSpeed(downVal, 0, 1024,
                Style.netunits_kbytes(), _('KiB/s'),
                Style.netunits_mbytes(), _('MiB/s'), 1024,
                Style.netunits_gbytes(), _('GiB/s'), 1048576);
            this._formatSpeed(upVal, 1, 1024,
                Style.netunits_kbytes(), _('KiB/s'),
                Style.netunits_mbytes(), _('MiB/s'), 1024,
                Style.netunits_gbytes(), _('GiB/s'), 1048576);
        }

        let compact = Style.get('') === '-compact';
        if (compact) {
            this.text_items[1].text = this._pad(this.tip_vals[0].toString(), 4);
            this.text_items[4].text = this._pad(this.tip_vals[2].toString(), 4);
            this.menu_items[0].text = this._pad(this.tip_vals[0].toString(), 4);
            this.menu_items[3].text = this._pad(this.tip_vals[2].toString(), 4);
        } else {
            this.text_items[1].text = this.tip_vals[0].toString();
            this.text_items[4].text = this.tip_vals[2].toString();
            this.menu_items[0].text = this.tip_vals[0].toString();
            this.menu_items[3].text = this.tip_vals[2].toString();
        }
    }

    _formatSpeed(val, idx, threshold, kUnit, kTip, mUnit, mTip, mDiv, gUnit, gTip, gDiv) {
        let textIdx = idx === 0 ? 2 : 5;
        let menuIdx = idx === 0 ? 1 : 4;
        let tipIdx = idx === 0 ? 0 : 2;

        if (val < threshold) {
            this.text_items[textIdx].text = kUnit;
            this.menu_items[menuIdx].text = this.tip_unit_labels[tipIdx].text = kTip;
            this.tip_vals[tipIdx] = val;
        } else if (val < threshold * threshold) {
            this.text_items[textIdx].text = mUnit;
            this.menu_items[menuIdx].text = this.tip_unit_labels[tipIdx].text = mTip;
            this.tip_vals[tipIdx] = (val / mDiv).toPrecision(3);
        } else {
            this.text_items[textIdx].text = gUnit;
            this.menu_items[menuIdx].text = this.tip_unit_labels[tipIdx].text = gTip;
            this.tip_vals[tipIdx] = (val / gDiv).toPrecision(3);
        }
    }

    _pad(number, length) {
        let str = '' + number;
        while (str.length < length)
            str = ' ' + str;
        return str;
    }

    create_text_items() {
        const Style = this.extension._Style;
        const IconSize = this.extension._IconSize;
        return [
            new St.Icon({icon_size: 2 * IconSize / 3 * Style.iconsize(),
                icon_name: 'go-down-symbolic'}),
            new St.Label({text: '', style_class: Style.get('sm-net-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({text: _('KiB/s'), style_class: Style.get('sm-net-unit-label'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Icon({icon_size: 2 * IconSize / 3 * Style.iconsize(),
                icon_name: 'go-up-symbolic'}),
            new St.Label({text: '', style_class: Style.get('sm-net-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({text: _('KiB/s'), style_class: Style.get('sm-net-unit-label'),
                y_align: Clutter.ActorAlign.CENTER}),
        ];
    }

    create_menu_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({text: '', style_class: Style.get('sm-value')}),
            new St.Label({text: _('KiB/s'), style_class: Style.get('sm-label')}),
            new St.Label({text: _(' ↓'), style_class: Style.get('sm-label')}),
            new St.Label({text: '', style_class: Style.get('sm-value')}),
            new St.Label({text: _(' KiB/s'), style_class: Style.get('sm-label')}),
            new St.Label({text: _(' ↑'), style_class: Style.get('sm-label')}),
        ];
    }
}

export { Net };
