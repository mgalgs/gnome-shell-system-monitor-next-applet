/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { ElementBase } from '../base.js';

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
        this.mounts = extension._MountsMonitor.get_mounts();
        this._mountListener = this.update_mounts.bind(this);
        extension._MountsMonitor.add_listener(this._mountListener);
        this.cursor = extension._Samplers.disk.cursor();
        this._last = new Map();
        this._lastTime = 0;

        if (this.device_id !== 'all') {
            this.label.text = this.device_id.split('/').pop();
            this.item_name = _('Disk') + ' ' + this.device_id;
        }
    }

    update_mounts(mounts) {
        this.mounts = mounts;
    }

    destroy() {
        this.extension._MountsMonitor.remove_listener(this._mountListener);
        super.destroy();
    }

    collectAsync(callback) {
        this.cursor.sample(reading => {
            if (this._destroyed || !reading?.data) { callback(null); return; }

            // Invariant: _last maps each device summed at the previous tick to
            // that device's counters at _lastTime. Every term below is therefore
            // a difference of two readings OF THE SAME DEVICE, so no term is
            // negative and neither is the total. A device appearing or
            // disappearing changes which terms exist, never the sign of one.
            let totals = [0, 0];
            const current = new Map();
            for (const [device, counters] of reading.data) {
                if (this.device_id !== 'all' && !this.device_id.includes(device))
                    continue;
                current.set(device, counters);
                const prev = this._last.get(device);
                // No previous reading means the device has just appeared, and
                // how much I/O preceded it is not knowable. A counter that went
                // backwards is that same name reused -- a card swapped in the
                // same reader, a mapper device torn down and recreated -- and
                // the kernel zeroes the whole stats struct, so either counter
                // witnesses it. Either way it contributes nothing for one tick
                // and re-baselines.
                if (!prev || counters[0] < prev[0] || counters[1] < prev[1])
                    continue;
                totals[0] += counters[0] - prev[0];
                totals[1] += counters[1] - prev[1];
            }
            this._last = current;

            // The reading's own instant, not the clock now: a reading taken for
            // a faster sibling and consumed here is older than this tick, and
            // dividing by the wrong interval understates the rate.
            let time = reading.time / 1000;
            let delta = (time - this._lastTime) / 1000;
            let usage = [0, 0];
            if (delta > 0) {
                for (let i = 0; i < 2; i++)
                    usage[i] = totals[i] / delta / 1024 / 8;
            }
            this._lastTime = time;

            let r = usage[0] < 10 ? Math.round(10 * usage[0]) / 10 : Math.round(usage[0]);
            let w = usage[1] < 10 ? Math.round(10 * usage[1]) / 10 : Math.round(usage[1]);
            const Locale = this.extension._Locale;
            const units = this.extension._Style.diskunits();
            callback({
                metrics: {read: usage[0], write: usage[1]},
                display: r.toLocaleString(Locale),
                display2: w.toLocaleString(Locale),
                unit: units, unit2: units,
                tipVals: [r, w],
            });
        });
    }
}

export { Disk };
