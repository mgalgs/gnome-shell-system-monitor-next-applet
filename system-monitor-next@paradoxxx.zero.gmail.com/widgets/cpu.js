/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GTop from "gi://GTop";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { ElementBase } from '../base.js';

const Cpu = class SystemMonitor_Cpu extends ElementBase {
    static metadata = {
        name: 'CPU',
        metrics: [
            { key: 'user', color: true },
            { key: 'system', color: true },
            { key: 'nice', color: true },
            { key: 'iowait', color: true },
            { key: 'other', color: true },
        ],
        tooltipUnit: '%',
    };

    constructor(extension, config) {
        super(extension, config);

        this.avg_sum = 0;
        this.avg_count = 0;
        this.avg_history = [];

        this.max = 100;

        if (this.device_id === 'all') {
            this.cpuid = -1;
        } else {
            this.cpuid = parseInt(this.device_id);
        }

        this.gtop = new GTop.glibtop_cpu();
        this.last = [0, 0, 0, 0, 0];
        this.current = [0, 0, 0, 0, 0];
        try {
            this.total_cores = GTop.glibtop_get_sysinfo().ncpu;
            if (this.cpuid === -1) {
                this.max *= this.total_cores;
            }
        } catch (e) {
            this.total_cores = 1;
            console.error(e);
        }
        this.last_total = 0;
        this.usage = [0, 0, 0, 1, 0];

        if (this.config.restoreAverage)
            // Restore the running average across enable/disable cycles
            // Must run after this.max/this.total_cores are finalized above,
            this._loadAvgState();

        if (this.cpuid !== -1) {
            this.item_name = _('CPU') + ' ' + (this.cpuid + 1);
            this.label.text = _('CPU') + (this.cpuid + 1);
        } else {
            this.item_name = _('CPU');
        }

    }
    collect() {
        GTop.glibtop_get_cpu(this.gtop);
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

        let percent;
        if (this.cpuid === -1) {
            percent = Math.round(((100 * this.total_cores) - this.usage[3]) /
                                 this.total_cores);
        } else {
            percent = Math.round((100 - this.usage[3]));
        }

        let max_samples = this.chart.width;
        this.avg_sum += percent;
        this.avg_history.push(percent);
        if (this.avg_count < max_samples) {
            this.avg_count++;
        } else {
            this.avg_sum -= this.avg_history.shift();
        }
        let avg = Math.round(this.avg_sum / this.avg_count);

        let other = 100;
        for (let i = 0; i < this.usage.length; i++) {
            other -= this.usage[i];
        }
        other = Math.max(0, other);

        return {
            metrics: {
                user: this.usage[0],
                system: this.usage[1],
                nice: this.usage[2],
                iowait: this.usage[4],
                other: other,
            },
            display: percent.toString(),
            extra: {
                average: avg.toString(),
            },
        };
    }
    create_extra_text_items() {
        const Style = this.extension._Style;
        return {
            average: new St.Label({
                text: '',
                style_class: Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER
            }),
            unit: new St.Label({
                text: '%',
                style_class: Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER
            })
        };
    }
    _getAvgStateFile() {
        // Keyed by device_id so per-core monitors (cpu0, cpu1, ..., all)
        // don't clobber each other's saved state.
        return GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            `system-monitor-next-cpu-avg-${this.device_id}.json`
        ]);
    }
    _loadAvgState() {
        try {
            const path = this._getAvgStateFile();
            if (!GLib.file_test(path, GLib.FileTest.EXISTS))
                return;

            const [ok, contents] = GLib.file_get_contents(path);
            if (!ok)
                return;

            const state = JSON.parse(new TextDecoder().decode(contents));

            if (typeof state.avg_sum === 'number' &&
                typeof state.avg_count === 'number' &&
                state.avg_count > 0) {

                const avg = state.avg_sum / state.avg_count;
                if (this.chart.width < state.avg_count) {
                    this.avg_count = this.chart.width;
                    this.avg_sum = Math.round(avg * this.avg_count);
                } else {
                    this.avg_count = state.avg_count;
                    this.avg_sum = state.avg_sum;
                }

                // Rebuild a synthetic history: avg_count copies of the
                // average, so future shift()/push() behaves exactly as
                // if we'd been collecting all along.

                const roundedAvg = Math.round(this.avg_sum / this.avg_count);
                this.avg_history = new Array(this.avg_count).fill(roundedAvg);

                let remainder = this.avg_sum - (roundedAvg * this.avg_count);
                const step = remainder > 0 ? 1 : -1;
                remainder = Math.abs(remainder);
                for (let i = 0; i < remainder; i++) {
                    this.avg_history[i] += step;
                }

                // avg_history is on the normalized 0-100 percent scale (see `percent`
                // in collect()), but the chart's raw data (this.vals fed via update())
                // is on a 0-this.max scale, which is 100 * total_cores for the 'all'
                // aggregate widget. Scale up to match, or the seeded line renders far
                // too low (e.g. 20 on a max-400 chart draws at 5% height).
                const chart_scale = this.max / 100;
                const scaled_history = (chart_scale !== 1)
                    ? this.avg_history.map(v => v * chart_scale)
                    : this.avg_history;
                this.chart.seed_flat(scaled_history);

                GLib.unlink(path);
            }
        } catch {
            // No saved state yet, or file unreadable/corrupt - start fresh.
        }
    }
    _saveAvgState() {
        try {
            const path = this._getAvgStateFile();
            const data = JSON.stringify({
                avg_sum: this.avg_sum,
                avg_count: this.avg_count,
            });
            GLib.file_set_contents(path, data);
        } catch (e) {
            console.error(e, 'SystemMonitor: failed to save CPU average state');
        }
    }
    destroy() {
        if (this.config.restoreAverage)
            this._saveAvgState();
        super.destroy();
    }
}

export { Cpu };
