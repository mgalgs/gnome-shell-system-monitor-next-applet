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

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GTop from "gi://GTop";
import { parse_bytearray } from './common.js';
import { sm_log } from './utils.js';

let _gen = 0;

// Deliberately shorter than base.js's own 30s guard on collectAsync, so that a
// wedged read is recovered in one place rather than by two timers racing on
// whichever happened to be armed first.
const SAMPLE_TIMEOUT_S = 15;

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

/**
 * One widget's position in an asynchronously read source.
 */
class AsyncCursor {
    constructor(sampler) {
        this._sampler = sampler;
        this._seen = 0;
    }

    /**
     * @param {Function} deliver - called with a reading, or with null if the
     *   read could not be completed. May be called synchronously.
     */
    sample(deliver) {
        this._sampler.take(this._seen, reading => {
            if (reading)
                this._seen = reading.gen;
            deliver(reading);
        });
    }
}

/**
 * A shared reading of a source that cannot be read synchronously.
 *
 * Callers arriving while a read is in flight join it rather than starting a
 * second one -- which is what makes sharing work at all for a source whose
 * read takes longer than the gap between two widgets' ticks.
 */
export class AsyncSampler {
    /**
     * @param {string} name - source name, used in log messages
     * @param {Function} read - (deliver) => cancel, where deliver(data) reports
     *   the result and the returned function, if any, abandons the read
     */
    constructor(name, read) {
        this.name = name;
        this._read = read;
        this._latest = NEVER;
        this._waiting = null;
        this._watchdog = null;
        this._cancel = null;
        this._wedgeLogged = false;
        this._destroyed = false;
    }

    cursor() {
        return new AsyncCursor(this);
    }

    take(seen, deliver) {
        if (this._destroyed) {
            deliver(null);
            return;
        }
        if (this._waiting) {
            // Joining the read in flight beats taking the older reading: the
            // one being fetched is fresher.
            this._waiting.push(deliver);
            return;
        }
        if (this._latest.gen !== seen) {
            deliver(this._latest);
            return;
        }

        this._waiting = [deliver];
        this._watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SAMPLE_TIMEOUT_S, () => {
            this._watchdog = null;
            if (!this._wedgeLogged) {
                sm_log(`${this.name}: read did not complete in ${SAMPLE_TIMEOUT_S}s; abandoned it`, 'warn');
                this._wedgeLogged = true;
            }
            // Killing rather than merely abandoning: a source that hangs would
            // otherwise leave one orphaned read behind every timeout, forever.
            this._abandonRead();
            this._flush(null);
            return GLib.SOURCE_REMOVE;
        });

        try {
            this._cancel = this._read(data => this._complete(data)) || null;
        } catch (e) {
            this._complete(null);
            sm_log(`${this.name}: read failed: ${e}`, 'warn');
        }
    }

    _complete(data) {
        // A late arrival, after the watchdog gave up: it describes an instant
        // SAMPLE_TIMEOUT_S gone, and the next tick reads fresh anyway.
        if (this._destroyed || !this._waiting)
            return;
        // Recovered means producing readings again, not merely no longer
        // hanging: a read that keeps completing with nothing has not recovered.
        if (this._wedgeLogged && data !== null) {
            sm_log(`${this.name}: reads recovered`);
            this._wedgeLogged = false;
        }
        this._latest = {gen: ++_gen, time: GLib.get_monotonic_time(), data};
        this._flush(this._latest);
    }

    // A read that completed with nothing is still a reading, and advances the
    // generation, so every sibling reports the same failure at the same instant
    // instead of some riding stale data.
    _flush(reading) {
        this._abandonWatchdog();
        this._cancel = null;
        const waiting = this._waiting;
        this._waiting = null;
        for (const deliver of waiting) {
            // One subscriber throwing must not strand the rest with their
            // pending flag stuck set, which would silently stop their updates.
            try {
                deliver(reading);
            } catch (e) {
                sm_log(`${this.name}: subscriber failed: ${e}`, 'error');
            }
        }
    }

    _abandonWatchdog() {
        if (this._watchdog) {
            GLib.Source.remove(this._watchdog);
            this._watchdog = null;
        }
    }

    _abandonRead() {
        if (this._cancel) {
            try {
                this._cancel();
            } catch (e) {
                sm_log(`${this.name}: could not abandon the read: ${e}`, 'warn');
            }
            this._cancel = null;
        }
    }

    destroy() {
        this._destroyed = true;
        this._abandonWatchdog();
        this._abandonRead();
        this._waiting = null;
        this._latest = NEVER;
    }
}

function readDiskstats(deliver) {
    const cancellable = new Gio.Cancellable();
    Gio.File.new_for_path('/proc/diskstats').load_contents_async(cancellable, (file, result) => {
        let stats = null;
        try {
            const [, contents] = file.load_contents_finish(result);
            stats = new Map();
            for (const line of parse_bytearray(contents).split('\n')) {
                const entry = line.trim().split(/[\s]+/);
                // A blank line ends the table; anything after it is not a device.
                if (typeof entry[1] === 'undefined')
                    break;
                stats.set(entry[2], [parseInt(entry[5]), parseInt(entry[9])]);
            }
        } catch {
            stats = null;
        }
        deliver(stats);
    });
    return () => cancellable.cancel();
}

// `sensors -jA` with no chip argument returns every chip -- which is the form
// common.js already uses to enumerate labels. libsensors reads every chip from
// sysfs regardless and the chip argument only filters the output, so keying a
// sampler by chip would spawn once per chip to no purpose.
function readSensors(deliver) {
    const proc = new Gio.Subprocess({
        argv: ['sensors', '-jA'],
        flags: Gio.SubprocessFlags.STDOUT_PIPE,
    });
    proc.init(null);
    proc.communicate_utf8_async(null, null, (p, result) => {
        try {
            const [, output] = p.communicate_utf8_finish(result);
            deliver(JSON.parse(output));
        } catch {
            deliver(null);
        }
    });
    return () => proc.force_exit();
}

// One line per GPU: "<index> <total MiB> <used MiB> <busy %>". See gpu_usage.sh
// for the contract; parsing it here once serves every GPU widget on the panel.
function parseGpuUsage(output) {
    const gpus = new Map();
    for (const line of output.split('\n')) {
        const field = line.trim().split(/\s+/);
        if (field.length < 4)
            continue;
        const total = parseInt(field[1]), used = parseInt(field[2]), busy = parseInt(field[3]);
        if (isNaN(total))
            continue;
        gpus.set(field[0], {
            total,
            used: isNaN(used) ? 0 : used,
            busy: isNaN(busy) ? 0 : busy,
        });
    }
    return gpus;
}

function readGpuUsage(extension) {
    return deliver => {
        const proc = new Gio.Subprocess({
            argv: ['/usr/bin/env', 'bash', `${extension.path}/gpu_usage.sh`],
            flags: Gio.SubprocessFlags.STDOUT_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, result) => {
            try {
                const [ok, output] = p.communicate_utf8_finish(result);
                deliver(ok ? parseGpuUsage(output) : null);
            } catch {
                deliver(null);
            }
        });
        return () => proc.force_exit();
    };
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

    get disk() {
        this._disk ??= this._add(new AsyncSampler('disk', readDiskstats));
        return this._disk;
    }

    get gpu() {
        this._gpu ??= this._add(new AsyncSampler('gpu', readGpuUsage(this._extension)));
        return this._gpu;
    }

    get sensors() {
        this._sensors ??= this._add(new AsyncSampler('sensors', readSensors));
        return this._sensors;
    }

    destroy() {
        for (const sampler of this._samplers)
            sampler.destroy();
        this._samplers = [];
        this._cpu = null;
        this._disk = null;
        this._gpu = null;
        this._sensors = null;
    }
}
