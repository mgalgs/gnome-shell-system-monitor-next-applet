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
                            if (this.device_id === 'all' || this.device_id === ifc) {
                                this.ifs.push(ifc);
                            }
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
        this.last = [0, 0, 0, 0, 0];
        this.usage = [0, 0, 0, 0, 0];
        this.last_time = 0;
        this.tip_format([_('KiB/s'), '/s', _('KiB/s'), '/s', '/s']);
        this.update_units();
        try {
            let iface_list = this.client.get_devices();
            this.NMsigID = [];
            for (let j = 0; j < iface_list.length; j++) {
                this.NMsigID[j] = iface_list[j].connect('state-changed', this.update_iface_list.bind(this));
            }
        } catch (e) {
            console.error('Please install Network Manager Gobject Introspection Bindings: ' + e);
        }
    }
    update_units() {
        this.speed_in_bits = this.config['speed-in-bits'] || false;
    }
    update_iface_list() {
        try {
            this.ifs = [];
            let iface_list = this.client.get_devices();
            for (let j = 0; j < iface_list.length; j++) {
                if (iface_list[j].state === NetworkManager.DeviceState.ACTIVATED) {
                    let iface = iface_list[j].get_ip_iface() || iface_list[j].get_iface();
                    if (this.device_id === 'all' || this.device_id === iface) {
                        this.ifs.push(iface);
                    }
                }
            }
        } catch {
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

export { Net };
