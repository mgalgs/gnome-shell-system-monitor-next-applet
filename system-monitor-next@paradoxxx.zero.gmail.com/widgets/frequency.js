/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GTop from "gi://GTop";
import St from "gi://St";
import { parse_bytearray } from '../common.js';
import { ElementBase } from '../base.js';

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

export { Freq };
