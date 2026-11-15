/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { parse_bytearray } from '../common.js';
import { ElementBase } from '../base.js';

// /proc/diskstats counts 512-byte sectors, whatever the device's sector size.
const SECTORS_PER_MIB = 2048;

function parse_diskstats(text) {
    const devices = new Map();
    for (const line of text.split('\n')) {
        const fields = line.trim().split(/\s+/);
        const readSectors = parseInt(fields[5]);
        const writeSectors = parseInt(fields[9]);
        // The last line is empty; no kernel since 2.6.25 prints a shorter row.
        if (isNaN(readSectors) || isNaN(writeSectors))
            continue;
        devices.set(fields[2], {readSectors, writeSectors});
    }
    return devices;
}

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
        // A hand-written config may name the device by its /dev path.
        this._deviceName = this.device_id.split('/').pop();
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
        let file = Gio.file_new_for_path('/proc/diskstats');
        file.load_contents_async(null, (source, result) => {
            if (this._destroyed) { callback(null); return; }
            let as_r = source.load_contents_finish(result);
            const devices = parse_diskstats(parse_bytearray(as_r[1]));
            const time = GLib.get_monotonic_time() / 1000;
            const delta = (time - this._lastTime) / 1000;
            if (delta <= 0) {
                callback(null);
                return;
            }
            const last = this._last;
            this._last = devices;
            this._lastTime = time;

            const sectors = {read: 0, write: 0};
            for (const [name, counters] of devices) {
                if (this.device_id !== 'all' && name !== this._deviceName)
                    continue;
                // A device that is new since the last reading, or whose
                // counters went back because it was recreated, has no
                // baseline yet; it counts from the next tick.
                const prev = last.get(name);
                if (!prev || counters.readSectors < prev.readSectors || counters.writeSectors < prev.writeSectors)
                    continue;
                sectors.read += counters.readSectors - prev.readSectors;
                sectors.write += counters.writeSectors - prev.writeSectors;
            }
            const read = sectors.read / delta / SECTORS_PER_MIB;
            const write = sectors.write / delta / SECTORS_PER_MIB;

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
