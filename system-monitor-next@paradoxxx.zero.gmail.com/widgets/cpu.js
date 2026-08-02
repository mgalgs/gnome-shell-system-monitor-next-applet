/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GTop from "gi://GTop";
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
        this.max = 100;

        if (this.device_id === 'all') {
            this.cpuid = -1;
        } else {
            this.cpuid = parseInt(this.device_id);
        }

        this.cursor = extension._Samplers.cpu.cursor();
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

        if (this.cpuid !== -1) {
            // Core ids are zero-based and core names are one-based, here and in
            // the preferences picker.
            this.device_name = String(this.cpuid + 1);
            this.item_name = _('CPU') + ' ' + (this.cpuid + 1);
            this.label.text = _('CPU') + (this.cpuid + 1);
        } else {
            this.item_name = _('CPU');
        }

    }
    collect() {
        const reading = this.cursor.sample();
        // The aggregate divides by the machine's total jiffies, a per-core
        // instance by that core's -- otherwise the same arithmetic.
        const counters = this.cpuid === -1 ? reading.data : reading.data.core(this.cpuid);
        const scale = this.cpuid === -1 ? 100 * this.total_cores : 100;

        this.current[0] = counters.user;
        this.current[1] = counters.system;
        this.current[2] = counters.nice;
        this.current[3] = counters.idle;
        this.current[4] = counters.iowait;
        let delta = (counters.total - this.last_total) / scale;

        if (delta > 0) {
            for (let i = 0; i < 5; i++) {
                this.usage[i] = Math.round((this.current[i] - this.last[i]) / delta);
                this.last[i] = this.current[i];
            }
            this.last_total = counters.total;
        } else if (delta < 0) {
            this.last = [0, 0, 0, 0, 0];
            this.current = [0, 0, 0, 0, 0];
            this.last_total = 0;
            this.usage = [0, 0, 0, 1, 0];
        }

        let percent;
        if (this.cpuid === -1) {
            percent = Math.round(((100 * this.total_cores) - this.usage[3]) /
                                 this.total_cores);
        } else {
            percent = Math.round((100 - this.usage[3]));
        }

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
        };
    }
}

export { Cpu };
