/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import St from "gi://St";
import { parse_bytearray } from '../common.js';
import { ElementBase } from '../base.js';

const Disk = class SystemMonitor_Disk extends ElementBase {
    static metadata = {
        name: 'Disk',
        metrics: [
            { key: 'read', color: true },
            { key: 'write', color: true },
        ],
        tooltipUnit: 'MiB/s',
    };

    constructor(extension, config) {
        super(extension, config);
        this.mounts = extension._MountsMonitor.get_mounts();
        extension._MountsMonitor.add_listener(this.update_mounts.bind(this));
        this._last = [0, 0];
        this._lastTime = 0;

        if (this.device_id !== 'all') {
            this.label.text = this.device_id.split('/').pop();
            this.item_name = _('Disk') + ' ' + this.device_id;
        }
    }

    update_mounts(mounts) {
        this.mounts = mounts;
    }

    collectAsync(callback) {
        let file = Gio.file_new_for_path('/proc/diskstats');
        file.load_contents_async(null, (source, result) => {
            let as_r = source.load_contents_finish(result);
            let lines = parse_bytearray(as_r[1]).toString().split('\n');
            let accum = [0, 0];

            for (let i = 0; i < lines.length; i++) {
                let entry = lines[i].trim().split(/[\s]+/);
                if (typeof entry[1] === 'undefined')
                    break;
                if (this.device_id !== 'all' && !this.device_id.includes(entry[2]))
                    continue;
                accum[0] += parseInt(entry[5]);
                accum[1] += parseInt(entry[9]);
            }

            let time = GLib.get_monotonic_time() / 1000;
            let delta = (time - this._lastTime) / 1000;
            let usage = [0, 0];
            if (delta > 0) {
                for (let i = 0; i < 2; i++) {
                    usage[i] = (accum[i] - this._last[i]) / delta / 1024 / 8;
                    this._last[i] = accum[i];
                }
            }
            this._lastTime = time;

            let r = usage[0] < 10 ? Math.round(10 * usage[0]) / 10 : Math.round(usage[0]);
            let w = usage[1] < 10 ? Math.round(10 * usage[1]) / 10 : Math.round(usage[1]);
            callback({read: usage[0], write: usage[1], _r: r, _w: w});
        });
    }

    format(data) {
        const Locale = this.extension._Locale;
        let r = data._r.toLocaleString(Locale);
        let w = data._w.toLocaleString(Locale);
        this.text_items[1].text = r;
        this.text_items[4].text = w;
        this.menu_items[0].text = r;
        this.menu_items[3].text = w;
        this.tip_vals[0] = data._r;
        this.tip_vals[1] = data._w;
    }

    create_text_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({text: _('R'), style_class: Style.get('sm-status-label')}),
            new St.Label({text: '', style_class: Style.get('sm-disk-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({text: Style.diskunits(), style_class: Style.get('sm-disk-unit-label'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({text: _('W'), style_class: Style.get('sm-status-label')}),
            new St.Label({text: '', style_class: Style.get('sm-disk-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({text: Style.diskunits(), style_class: Style.get('sm-disk-unit-label'),
                y_align: Clutter.ActorAlign.CENTER}),
        ];
    }

    create_menu_items() {
        const Style = this.extension._Style;
        return [
            new St.Label({text: '', style_class: Style.get('sm-value')}),
            new St.Label({text: Style.diskunits(), style_class: Style.get('sm-label')}),
            new St.Label({text: ' ' + _('R'), style_class: Style.get('sm-label')}),
            new St.Label({text: '', style_class: Style.get('sm-value')}),
            new St.Label({text: Style.diskunits(), style_class: Style.get('sm-label')}),
            new St.Label({text: ' ' + _('W'), style_class: Style.get('sm-label')}),
        ];
    }
}

export { Disk };
