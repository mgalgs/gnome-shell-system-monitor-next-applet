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
        let display_mode = this.config['display-mode'] || 'max';
        let indices;
        if (this.device_id !== 'all') {
            indices = [parseInt(this.device_id)];
        } else {
            let num_cpus = GTop.glibtop_get_sysinfo().ncpu;
            indices = Array.from({length: num_cpus}, (_v, i) => i);
        }

        let total_frequency = 0;
        let max_frequency = 0;
        let read_count = 0;
        let pos = 0;

        // Read each core's scaling_cur_freq sequentially, tolerating cores
        // without cpufreq (common in VMs/containers). A throw from
        // load_contents_finish here must not break the chain, or the
        // callback would never fire and update() would time out every tick.
        const readNext = () => {
            if (this._destroyed) { callback(null); return; }
            if (pos >= indices.length) {
                if (read_count === 0) {
                    callback(null);
                    return;
                }
                let freq = display_mode === 'average'
                    ? Math.round(total_frequency / read_count / 1000)
                    : Math.round(max_frequency / 1000);
                callback(this._buildResult(freq));
                return;
            }
            let i = indices[pos++];
            let file = Gio.file_new_for_path(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
            file.load_contents_async(null, (source, result) => {
                try {
                    let [, contents] = source.load_contents_finish(result);
                    let current_freq = parseInt(parse_bytearray(contents));
                    if (!isNaN(current_freq)) {
                        total_frequency += current_freq;
                        max_frequency = Math.max(max_frequency, current_freq);
                        read_count++;
                    }
                } catch {
                    // cpufreq unavailable for this core; skip it
                }
                readNext();
            });
        };

        readNext();
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
