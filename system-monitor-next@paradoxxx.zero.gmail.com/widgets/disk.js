/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { sm_log } from '../utils.js';
import { ElementBase } from '../base.js';

// /proc/diskstats counts 512-byte sectors, so a MiB is 2048 of them. The panel
// divided by 1024 and again by 8 and labelled the result MiB/s, which is a
// quarter of it: measured against dd's own reported throughput, 98.2 shown for
// a real 392.8 MiB/s.
const SECTORS_PER_MIB = 2048;

const Disk = class SystemMonitor_Disk extends ElementBase {
    static metadata = {
        name: 'Disk',
        metrics: [
            { key: 'read', color: true },
            { key: 'write', color: true },
        ],
        panelLayout: 'dual',
        menuLayout: 'dual',
        dualLabels: ['R', 'W'],
        panelValueStyle: 'sm-disk-value',
        panelUnitStyle: 'sm-disk-unit-label',
        panelUnit: '',
        menuUnit: '',
        tooltipUnit: 'MiB/s',
    };

    constructor(extension, config) {
        super(extension, config);
        this.cursor = extension._Samplers.disk.cursor();
        this._last = new Map();
        this._lastTime = 0;
        this._missingLogged = false;
        this._noMediumLogged = false;

        if (this.device_id !== 'all') {
            this.label.text = this.device_id.split('/').pop();
            this.item_name = _('Disk') + ' ' + this.device_id;
        }
    }

    // A disk can be selected and then removed, or named in a config carried
    // over from another machine. The panel can only show "--"; which devices do
    // exist is the difference between a mystery and a one-line diagnosis, and
    // it separates a bad selection from a bad machine.
    _reportMissing(devices) {
        if (this._missingLogged)
            return;
        this._missingLogged = true;
        sm_log(`${this.item_name}: /proc/diskstats lists ${[...devices.keys()].join(', ')} — ` +
               `nothing for "${this.device_id}". Showing --.`, 'warn');
    }

    // A total of zero while a disk works is the one way this rule looks broken,
    // and it happens on a machine whose storage reaches no local hardware -- one
    // booted from a network block device, say. The picker says what the total
    // excludes; this is for whoever never opens it, and it names devices that
    // are both in the message and selectable in the dialog.
    _reportNoMedium(devices) {
        if (this._noMediumLogged)
            return;
        this._noMediumLogged = true;
        sm_log(`${this.item_name}: none of ${[...devices.keys()].join(', ')} is a physical ` +
               'disk — showing 0. To measure one of them, add a monitor for it in ' +
               'preferences.', 'warn');
    }

    // An aggregate covers the media; a named monitor covers exactly its row,
    // medium or not, because naming a device is an explicit request for it.
    _covers(device, counters) {
        return this.device_id === 'all' ? counters.medium : device === this.device_id;
    }

    collectAsync(callback) {
        this.cursor.sample(reading => {
            if (this._destroyed || !reading?.data) { callback(null); return; }

            // Invariant: _last is the previous reading's device table and
            // _lastTime is the instant it was read at. Every term below is
            // therefore a difference of two readings OF THE SAME DEVICE, so no
            // term is negative and neither is the total. Which devices are
            // covered changes which terms exist, never the sign of one -- and
            // because _last holds every device rather than only the covered
            // ones, a device that starts being covered still finds its own
            // baseline instead of losing a tick.
            const totals = {read: 0, write: 0};
            let covered = 0;
            for (const [device, counters] of reading.data) {
                if (!this._covers(device, counters))
                    continue;
                covered++;
                const prev = this._last.get(device);
                // No previous reading means the device has just appeared, and
                // how much I/O preceded it is not knowable. A counter that went
                // backwards is that same name reused -- a card swapped in the
                // same reader, a mapper device torn down and recreated -- and
                // the kernel zeroes the whole stats struct, so either counter
                // witnesses it. Either way it contributes nothing for one tick
                // and re-baselines.
                if (!prev || counters.readSectors < prev.readSectors ||
                    counters.writeSectors < prev.writeSectors)
                    continue;
                totals.read += counters.readSectors - prev.readSectors;
                totals.write += counters.writeSectors - prev.writeSectors;
            }
            // The counters and the instant they were read at advance together,
            // or the next tick divides one device set's delta by another's
            // interval. The reading's own instant, not the clock now: a reading
            // taken for a faster sibling and consumed here is older than this
            // tick, and dividing by the wrong interval understates the rate.
            const time = reading.time / 1000;
            const delta = (time - this._lastTime) / 1000;
            // A delivered reading is never mutated, so the table can be kept
            // rather than copied.
            this._last = reading.data;
            this._lastTime = time;

            // A named device that is not in the table is not a device reading
            // zero. An "all" that matched nothing is: an aggregate is a fold
            // over a set, and the empty set folds to a real zero.
            if (covered === 0) {
                if (this.device_id === 'all') {
                    this._reportNoMedium(reading.data);
                } else {
                    this._reportMissing(reading.data);
                    callback(null);
                    return;
                }
            } else {
                this._missingLogged = false;
                this._noMediumLogged = false;
            }

            const rate = sectors => delta > 0 ? sectors / delta / SECTORS_PER_MIB : 0;
            const read = rate(totals.read), write = rate(totals.write);

            let r = read < 10 ? Math.round(10 * read) / 10 : Math.round(read);
            let w = write < 10 ? Math.round(10 * write) / 10 : Math.round(write);
            const Locale = this.extension._Locale;
            const units = this.extension._Style.diskunits();
            callback({
                metrics: {read, write},
                display: r.toLocaleString(Locale),
                display2: w.toLocaleString(Locale),
                unit: units, unit2: units,
                tipVals: [r, w],
            });
        });
    }
}

export { Disk };
