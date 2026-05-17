/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GTop from "gi://GTop";
import St from "gi://St";
import { parse_bytearray } from '../common.js';
import { ElementBase } from '../base.js';

const Freq = class SystemMonitor_Freq extends ElementBase {
    static metadata = {
        name: 'Freq',
        metrics: [{ key: 'freq', color: true }],
        tooltipUnit: 'MHz',
        panelUnit: 'MHz',
        menuUnit: 'MHz',
    };

    constructor(extension, config) {
        super(extension, config);
        this.freq = 0;

        if (this.device_id !== 'all') {
            let coreNum = parseInt(this.device_id) + 1;
            this.label.text = _('F') + coreNum;
            this.item_name = _('Freq Core ') + coreNum;
        }

    }
    refresh() {
        let total_frequency = 0;
        let max_frequency = 0;
        let num_cpus = GTop.glibtop_get_sysinfo().ncpu;
        let display_mode = this.config['display-mode'] || 'max';

        if (this.device_id !== 'all') {
            let i = parseInt(this.device_id);
            let file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
            file.load_contents_async(null, (source, result) => {
                let as_r = source.load_contents_finish(result);
                this.freq = Math.round(parseInt(parse_bytearray(as_r[1])) / 1000);
            });
        } else {
            let i = 0;
            let file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
            let that = this;

            file.load_contents_async(null, function cb(source, result) {
                let as_r = source.load_contents_finish(result);
                let current_freq = parseInt(parse_bytearray(as_r[1]));

                total_frequency += current_freq;
                max_frequency = Math.max(max_frequency, current_freq);

                if (++i >= num_cpus) {
                    if (display_mode === 'max') {
                        that.freq = Math.round(max_frequency / 1000);
                    } else {
                        that.freq = Math.round(total_frequency / num_cpus / 1000);
                    }
                } else {
                    file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
                    file.load_contents_async(null, cb.bind(that));
                }
            });
        }
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
}

export { Freq };
