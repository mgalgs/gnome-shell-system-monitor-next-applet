/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GTop from "gi://GTop";
import { ElementBase } from '../base.js';

const Cpu = class SystemMonitor_Cpu extends ElementBase {
    static metadata = {
        id: 'cpu',
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

    constructor(extension, cpuid) {
        super(extension);
        this.max = 100;

        this.cpuid = cpuid;
        this.gtop = new GTop.glibtop_cpu();
        this.last = [0, 0, 0, 0, 0];
        this.current = [0, 0, 0, 0, 0];
        try {
            this.total_cores = GTop.glibtop_get_sysinfo().ncpu;
            if (cpuid === -1) {
                this.max *= this.total_cores;
            }
        } catch (e) {
            this.total_cores = this.get_cores();
            console.error(e)
        }
        this.last_total = 0;
        this.usage = [0, 0, 0, 1, 0];
        this.item_name = _('Cpu');
        if (cpuid !== -1) {
            this.item_name += ' ' + (cpuid + 1);
        }
        this.update();
    }
    refresh() {
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
    }
    _apply() {
        let percent = 0;
        if (this.cpuid === -1) {
            percent = Math.round(((100 * this.total_cores) - this.usage[3]) /
                                 this.total_cores);
        } else {
            percent = Math.round((100 - this.usage[3]));
        }

        this.text_items[0].text = this.menu_items[0].text = percent.toString();
        let other = 100;
        for (let i = 0; i < this.usage.length; i++) {
            other -= this.usage[i];
        }
        other = Math.max(0, other);
        this.vals = [this.usage[0], this.usage[1],
            this.usage[2], this.usage[4], other];
        for (let i = 0; i < 5; i++) {
            this.tip_vals[i] = Math.round(this.vals[i]);
        }
    }

    get_cores() {
        return 1;
    }
}

function createCpus(extension) {
    let array = [];
    let numcores = 1;

    if (extension._Schema.get_boolean('cpu-individual-cores')) {
        let gtop = new GTop.glibtop_cpu();
        try {
            numcores = GTop.glibtop_get_sysinfo().ncpu;
        } catch (e) {
            console.error(e);
            numcores = 1;
        }
    }

    if (numcores > 1) {
        for (let i = 0; i < numcores; i++) {
            array.push(new Cpu(extension, i));
        }
    } else {
        array.push(new Cpu(extension, -1));
    }

    return array;
}

export { Cpu, createCpus };
