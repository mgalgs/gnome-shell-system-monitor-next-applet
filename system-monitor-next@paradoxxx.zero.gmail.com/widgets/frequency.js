/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import GTop from "gi://GTop";
import { parse_bytearray } from '../common.js';
import { ElementBase } from '../base.js';

const Freq = class SystemMonitor_Freq extends ElementBase {
    static metadata = {
        name: 'Freq',
        metrics: [{ key: 'freq', color: true }],
        tooltipUnit: 'MHz',
        panelUnit: 'MHz',
        menuUnit: 'MHz',
        panelValueStyle: 'sm-big-status-value',
        panelUnitStyle: 'sm-perc-label',
    };

    constructor(extension, config) {
        super(extension, config);

        if (this.device_id !== 'all') {
            let coreNum = parseInt(this.device_id) + 1;
            this.label.text = _('F') + coreNum;
            this.item_name = _('Freq Core ') + coreNum;
        }

    }
    collectAsync(callback) {
        let total_frequency = 0;
        let max_frequency = 0;
        let num_cpus = GTop.glibtop_get_sysinfo().ncpu;
        let display_mode = this.config['display-mode'] || 'max';

        if (this.device_id !== 'all') {
            let i = parseInt(this.device_id);
            let file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
            file.load_contents_async(null, (source, result) => {
                let as_r = source.load_contents_finish(result);
                let freq = Math.round(parseInt(parse_bytearray(as_r[1])) / 1000);
                callback(this._buildResult(freq));
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
                    let freq;
                    if (display_mode === 'max') {
                        freq = Math.round(max_frequency / 1000);
                    } else {
                        freq = Math.round(total_frequency / num_cpus / 1000);
                    }
                    callback(that._buildResult(freq));
                } else {
                    file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
                    file.load_contents_async(null, cb.bind(that));
                }
            });
        }
    }
    _buildResult(freq) {
        let value = freq.toString();
        let compact = this.extension._Style.get('') === '-compact';
        let menuDisplay = compact ? this._pad(value, 4) : value;
        return {metrics: {freq: value}, display: value, menuDisplay: menuDisplay};
    }
    _pad(str, length) {
        while (str.length < length)
            str = ' ' + str;
        return str;
    }
}

export { Freq };
