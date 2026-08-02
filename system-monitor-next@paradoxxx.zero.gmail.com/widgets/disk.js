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
        this._last = [0, 0];
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
            let accum = [0, 0];

            for (const [device, counters] of reading.data) {
                if (this.device_id !== 'all' && !this.device_id.includes(device))
                    continue;
                accum[0] += counters[0];
                accum[1] += counters[1];
            }

            // The reading's own instant, not the clock now: a reading taken for
            // a faster sibling and consumed here is older than this tick, and
            // dividing by the wrong interval understates the rate.
            let time = reading.time / 1000;
            let delta = (time - this._lastTime) / 1000;
            let usage = [0, 0];
            if (delta > 0) {
                for (let i = 0; i < 2; i++) {
                    usage[i] = (accum[i] - this._last[i]) / delta / 1024 / 8;
                    this._last[i] = accum[i];
                }
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
