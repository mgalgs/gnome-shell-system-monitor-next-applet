/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// One read of a shared source, however many widgets consume it.
//
// A source is read by whichever widget's timer fires first; every widget that
// has not yet consumed that reading takes it without a second read. Nothing
// here owns a refresh timer -- widgets keep their own.
//
// The whole correctness argument rests on generations being globally
// increasing: if a sampler's latest generation differs from the one a cursor
// last consumed, it is necessarily *newer*, so a free ride is never a repeat.
// Global rather than per-sampler so that a cursor holding a generation from a
// sampler that no longer exists still reads correctly.

'use strict';

import GLib from "gi://GLib";
import GTop from "gi://GTop";

let _gen = 0;

// The reading that was never taken. A cursor starts at generation 0 and so
// always forces a first read, which means there is no null case to branch on.
const NEVER = {gen: 0, time: 0, data: null};

/**
 * One widget's position in one sampler's sequence of readings.
 *
 * The position lives here rather than in the widget so that it cannot advance
 * without a reading being delivered, and cannot be pointed at a second sampler
 * -- two samplers sharing a token would each make the other look fresh, and
 * neither would ever be refreshed.
 */
class Cursor {
    constructor(sampler) {
        this._sampler = sampler;
        this._seen = 0;
    }

    /**
     * @returns {{gen: number, time: number, data: *}}
     */
    sample() {
        const reading = this._sampler.take(this._seen);
        this._seen = reading.gen;
        return reading;
    }
}

/**
 * A shared reading of one synchronously readable source.
 */
export class Sampler {
    /**
     * @param {string} name - source name, used in log messages
     * @param {Function} read - () => data
     */
    constructor(name, read) {
        this.name = name;
        this._read = read;
        this._latest = NEVER;
    }

    cursor() {
        return new Cursor(this);
    }

    /**
     * @param {number} seen - generation the caller last consumed
     * @returns {{gen: number, time: number, data: *}} a reading the caller has not consumed
     */
    take(seen) {
        if (this._latest.gen === seen) {
            // A throw here reaches the widget, which logs it and retries next
            // tick. The generation deliberately does not advance, so every
            // sibling retries too rather than riding a stale reading.
            const data = this._read();
            this._latest = {gen: ++_gen, time: GLib.get_monotonic_time(), data};
        }
        return this._latest;
    }

    destroy() {
        this._latest = NEVER;
    }
}

// Reading a GTop array field crosses into C and copies the whole array, so a
// reading touches each one at most once -- and not at all for a monitor that
// only wants the total, which is what the default configuration asks for.
const XCPU_FIELDS = {
    user: 'xcpu_user', system: 'xcpu_sys', nice: 'xcpu_nice',
    idle: 'xcpu_idle', iowait: 'xcpu_iowait', total: 'xcpu_total',
};

class CpuReading {
    constructor(buf) {
        this._buf = buf;
        this._cores = null;
        this.user = buf.user;
        this.system = buf.sys;
        this.nice = buf.nice;
        this.idle = buf.idle;
        this.iowait = buf.iowait;
        this.total = buf.total;
    }

    /**
     * @param {number} i - core index
     * @returns {{user, system, nice, idle, iowait, total}} that core's counters
     */
    core(i) {
        if (!this._cores) {
            this._cores = {};
            for (const [key, field] of Object.entries(XCPU_FIELDS))
                this._cores[key] = this._buf[field];
        }
        const c = this._cores;
        return {
            user: c.user[i], system: c.system[i], nice: c.nice[i],
            idle: c.idle[i], iowait: c.iowait[i], total: c.total[i],
        };
    }
}

function readCpu() {
    // A fresh buffer per reading: the lazy core() memo above is only sound
    // while nothing can refill the struct a reading was built from.
    const buf = new GTop.glibtop_cpu();
    GTop.glibtop_get_cpu(buf);
    return new CpuReading(buf);
}

/**
 * Every sampler for one enabled extension.
 *
 * Lifetime belongs to the extension rather than the module because GNOME Shell
 * caches extension modules for the life of the shell process: anything holding
 * a GLib source or a live session must be torn down with the extension, not
 * left for a reset call somebody has to remember.
 */
export class smSamplers {
    constructor(extension) {
        this._extension = extension;
        this._samplers = [];
    }

    _add(sampler) {
        this._samplers.push(sampler);
        return sampler;
    }

    get cpu() {
        this._cpu ??= this._add(new Sampler('cpu', readCpu));
        return this._cpu;
    }

    destroy() {
        for (const sampler of this._samplers)
            sampler.destroy();
        this._samplers = [];
        this._cpu = null;
    }
}
