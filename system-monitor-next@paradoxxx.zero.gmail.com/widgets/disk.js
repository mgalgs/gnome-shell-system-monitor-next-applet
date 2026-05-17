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
        this.last = [0, 0];
        this.usage = [0, 0];
        this.last_time = 0;

        if (this.device_id !== 'all') {
            this.label.text = this.device_id.split('/').pop();
            this.item_name = _('Disk') + ' ' + this.device_id;
        }

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

                if (this.device_id !== 'all') {
                    let deviceName = entry[2];
                    if (!this.device_id.includes(deviceName)) {
                        continue;
                    }
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

export { Disk };
