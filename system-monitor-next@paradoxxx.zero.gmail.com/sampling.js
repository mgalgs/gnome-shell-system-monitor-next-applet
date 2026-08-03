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
import Soup from "gi://Soup?version=3.0";
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
 * Widgets that share a refresh interval share a heartbeat.
 *
 * One timer per widget, phased by whenever it happened to be constructed, made
 * sixteen core graphs step at sixteen different moments and drift apart from
 * there -- the strip ripples instead of moving, and once the phases scatter far
 * enough a load spike appears on one core's graph and then the next, a
 * migration that is not in the data.
 *
 * Grouping by interval rather than by source is deliberate: sharing a moment is
 * grouping by refresh interval, sharing a reading is grouping by source, and
 * two CPU widgets at 500ms and 3000ms must share the source and must not share
 * the moment.
 */
export class smTickClock {
    constructor() {
        this._buckets = new Map();
    }

    /**
     * @param {object} widget - anything with update(); joins that interval's bucket
     * @param {number} interval - milliseconds
     */
    register(widget, interval) {
        this.unregister(widget);
        let bucket = this._buckets.get(interval);
        if (!bucket) {
            bucket = {widgets: new Set(), source: 0};
            bucket.source = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, interval, () => {
                // A copy: a widget destroyed by its own update would otherwise
                // mutate the set being walked.
                for (const w of [...bucket.widgets]) {
                    // update() contains its own error handling, but a throw
                    // escaping here would remove the source and silently stop
                    // every other widget on this interval, not just this one.
                    try {
                        w.update();
                    } catch (e) {
                        sm_log(`tick: widget update failed: ${e}`, 'error');
                    }
                }
                return GLib.SOURCE_CONTINUE;
            });
            this._buckets.set(interval, bucket);
        }
        bucket.widgets.add(widget);
    }

    unregister(widget) {
        for (const [interval, bucket] of this._buckets) {
            if (!bucket.widgets.delete(widget))
                continue;
            if (bucket.widgets.size === 0) {
                GLib.Source.remove(bucket.source);
                this._buckets.delete(interval);
            }
            return;
        }
    }

    destroy() {
        for (const bucket of this._buckets.values())
            GLib.Source.remove(bucket.source);
        this._buckets.clear();
    }
}

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
        this._faultLogged = false;
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
            this._reportFault(`read did not complete in ${SAMPLE_TIMEOUT_S}s; abandoned it`);
            // Killing rather than merely abandoning: a source that hangs would
            // otherwise leave one orphaned read behind every timeout, forever.
            this._abandonRead();
            this._flush(null);
            return GLib.SOURCE_REMOVE;
        });

        try {
            const cancel = this._read((data, reason) => this._complete(data, reason));
            // A read that delivered synchronously has already flushed and cleared
            // the handle; storing one now would leave a cancel for a completed
            // read, to be called on the next timeout or teardown.
            if (this._waiting)
                this._cancel = cancel || null;
        } catch (e) {
            this._complete(null, `read failed: ${e}`);
        }
    }

    /**
     * @param {*} data - the reading, or null if the source produced nothing
     * @param {string} [reason] - why, when it produced nothing; logged once per
     *   outage so that a source failing every tick does not fill the journal
     */
    _complete(data, reason) {
        // A late arrival, after the watchdog gave up: it describes an instant
        // SAMPLE_TIMEOUT_S gone, and the next tick reads fresh anyway.
        if (this._destroyed || !this._waiting)
            return;
        if (data === null) {
            this._reportFault(reason || 'read produced nothing');
        } else if (this._faultLogged) {
            sm_log(`${this.name}: reads recovered`);
            this._faultLogged = false;
        }
        this._latest = {gen: ++_gen, time: GLib.get_monotonic_time(), data};
        this._flush(this._latest);
    }

    _reportFault(reason) {
        if (this._faultLogged)
            return;
        this._faultLogged = true;
        sm_log(`${this.name}: ${reason}`, 'warn');
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

// The counters are in 512-byte sectors, which is what the kernel publishes
// whatever the device's own sector size, so the names say so: a consumer that
// reads `read` cannot tell whether it still owes itself the conversion.
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
                const readSectors = parseInt(entry[5]), writeSectors = parseInt(entry[9]);
                // A row too short to hold both counters is not a device reading
                // zero, and admitting it as NaN would poison every sum it joins
                // -- one bad row and the whole aggregate reads NaN, forever.
                if (isNaN(readSectors) || isNaN(writeSectors))
                    continue;
                stats.set(entry[2], {readSectors, writeSectors});
            }
        } catch (e) {
            deliver(null, `could not read /proc/diskstats: ${e.message}`);
            return;
        }
        deliver(stats);
    });
    return () => cancellable.cancel();
}

// /proc/net/dev holds every interface in one table, so this sampler needs no
// key -- which is what makes it shareable at all. glibtop_get_netload reads one
// interface per call, so an `all` monitor beside two member monitors made four
// calls per tick over two interfaces.
//
// Column numbers are counted from after the interface's colon. Verified
// field-for-field against glibtop_get_netload on every interface of a live
// machine: all five are identical.
const NET_COLUMNS = [
    ['bytes_in', 0], ['errors_in', 2],
    ['bytes_out', 8], ['errors_out', 10], ['collisions', 13],
];

// ARPHRD_PPP: a PPP link is the machine's edge by definition, and the kernel
// puts no net device under it -- its hardware is a serial device.
const ARPHRD_PPP = 512;

// `edge` answers "is this where traffic enters or leaves the machine?", which
// is the question a total wants: traffic is layered, so a packet sent over a
// tunnel is counted on the tunnel and again, encapsulated, on the wifi carrying
// it. The field is named for the role rather than for the test below, because
// the test already grew a second clause and a field called `hardware` would
// then misdescribe its own contents.
//
// Double-counting is really a property of a *pair* of interfaces, and the
// kernel publishes only one of the two mechanisms that create such pairs:
// device stacking (bridge over NIC) appears as `lower_*`/`master` links, while
// tunnelling is a routing fact with nothing in sysfs tying wg0 to wlp3s0. So no
// rule over single interfaces can be exact; this is the best available proxy,
// and it is measured to separate a real NIC from bridge, veth, docker, tun,
// wireguard, dummy and loopback with no name matching.
//
// Classified on every read rather than memoised by name: the test costs 4.6us
// per interface, so even a 30-interface Docker host pays 137us, and a memo
// would be quietly wrong when a name is reused by a different kind of device.
function markEdges(interfaces) {
    let hardware = false;
    for (const [name, counters] of interfaces) {
        counters.edge = GLib.file_test(`/sys/class/net/${name}/device`, GLib.FileTest.EXISTS);
        hardware ||= counters.edge;
    }
    if (hardware)
        return;
    // Consulted only when nothing hardware-backed was found, which is what the
    // clause means -- PPP is an edge precisely because no net device sits under
    // it -- and also what keeps it cheap: reading `type` costs 8.4us per
    // interface, and it cannot apply while a hardware interface exists.
    for (const [name, counters] of interfaces)
        counters.edge = isPpp(name);
}

function isPpp(name) {
    try {
        const [ok, contents] = GLib.file_get_contents(`/sys/class/net/${name}/type`);
        return ok && parseInt(parse_bytearray(contents)) === ARPHRD_PPP;
    } catch {
        // The interface went away between the two reads.
        return false;
    }
}

function readNetDev(deliver) {
    const cancellable = new Gio.Cancellable();
    Gio.File.new_for_path('/proc/net/dev').load_contents_async(cancellable, (file, result) => {
        let interfaces = null;
        try {
            const [, contents] = file.load_contents_finish(result);
            interfaces = new Map();
            // Two header lines name the columns; every line after them is an
            // interface, and the colon is what separates its name from them.
            for (const line of parse_bytearray(contents).split('\n').slice(2)) {
                const colon = line.indexOf(':');
                if (colon < 0)
                    continue;
                const field = line.slice(colon + 1).trim().split(/\s+/);
                const counters = {};
                for (const [key, column] of NET_COLUMNS)
                    counters[key] = parseInt(field[column]);
                interfaces.set(line.slice(0, colon).trim(), counters);
            }
            markEdges(interfaces);
        } catch (e) {
            deliver(null, `could not read /proc/net/dev: ${e.message}`);
            return;
        }
        deliver(interfaces);
    });
    return () => cancellable.cancel();
}

// A scrape is the whole exposition -- 100-500 KB for node_exporter -- and every
// widget on that server greps one line out of the same text. Splitting it is as
// much of the per-widget cost as fetching it, so the reading carries the split
// and does it once, on first use.
class ScrapeReading {
    constructor(text) {
        this.text = text;
        this._lines = null;
    }

    lines() {
        this._lines ??= this.text.split('\n');
        return this._lines;
    }
}

function readScrape(session, server) {
    return deliver => {
        const cancellable = new Gio.Cancellable();
        const message = Soup.Message.new('GET', `${server}/metrics`);
        if (!message) {
            deliver(null);
            return null;
        }
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, result) => {
            try {
                const bytes = s.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK) {
                    deliver(null, `scrape returned HTTP ${message.get_status()}`);
                    return;
                }
                deliver(new ScrapeReading(new TextDecoder().decode(bytes.get_data())));
            } catch (e) {
                deliver(null, `scrape failed: ${e.message}`);
            }
        });
        return () => cancellable.cancel();
    };
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
        } catch (e) {
            deliver(null, `could not read sensor chips: ${e.message}`);
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
                deliver(ok ? parseGpuUsage(output) : null, 'gpu_usage.sh could not be run');
            } catch (e) {
                deliver(null, `gpu_usage.sh failed: ${e.message}`);
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
        this._scrapes = new Map();
        this._session = null;
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

    get net() {
        this._net ??= this._add(new AsyncSampler('net', readNetDev));
        return this._net;
    }

    get sensors() {
        this._sensors ??= this._add(new AsyncSampler('sensors', readSensors));
        return this._sensors;
    }

    /**
     * Keyed by server: separate endpoints are separate reads, and there is no
     * call that fetches several at once.
     * @param {string} server - base URL
     * @returns {AsyncSampler}
     */
    prometheus(server) {
        let sampler = this._scrapes.get(server);
        if (!sampler) {
            this._session ??= new Soup.Session({timeout: 10});
            sampler = this._add(new AsyncSampler(`prometheus ${server}`,
                readScrape(this._session, server)));
            this._scrapes.set(server, sampler);
        }
        return sampler;
    }

    destroy() {
        for (const sampler of this._samplers)
            sampler.destroy();
        this._samplers = [];
        this._cpu = null;
        this._disk = null;
        this._gpu = null;
        this._net = null;
        this._sensors = null;
        this._scrapes.clear();
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }
}
