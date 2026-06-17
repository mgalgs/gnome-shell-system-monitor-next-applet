/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { parse_bytearray } from '../common.js';
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
        let file = Gio.file_new_for_path('/proc/diskstats');
        file.load_contents_async(null, (source, result) => {
            if (this._destroyed) { callback(null); return; }
            let as_r = source.load_contents_finish(result);
            let lines = parse_bytearray(as_r[1]).toString().split('\n');
            let accum = [0, 0];

            for (let i = 0; i < lines.length; i++) {
                let entry = lines[i].trim().split(/[\s]+/);
                if (typeof entry[1] === 'undefined')
                    break;
                if (this.device_id !== 'all' && !this.device_id.includes(entry[2]))
                    continue;
                accum[0] += parseInt(entry[5]);
                accum[1] += parseInt(entry[9]);
            }

            let time = GLib.get_monotonic_time() / 1000;
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
