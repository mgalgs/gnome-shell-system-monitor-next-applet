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
        // Device name to whether it is a hardware disk, null while looking.
        this._hardware = new Map();
        this._last = null;
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

    // The block layer counts a request at every device it passes through, so
    // the total counts only hardware disks: rows with a `device` link to
    // their parent. Partitions, dm, md, loop and zram have none. A named
    // device counts whatever its layer.
    _counts(name) {
        if (this.device_id === 'all')
            return this._hardware.get(name) === true;
        return name === this._deviceName;
    }

    // Asks sysfs once per new name, without blocking, and forgets names that
    // have left the reading.
    _updateHardware(devices) {
        for (const name of this._hardware.keys()) {
            if (!devices.has(name))
                this._hardware.delete(name);
        }
        for (const name of devices.keys()) {
            if (this._hardware.has(name))
                continue;
            this._hardware.set(name, null);
            Gio.file_new_for_path(`/sys/class/block/${name}/device`).query_info_async(
                'standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
                (file, result) => {
                    let hardware = true;
                    try {
                        file.query_info_finish(result);
                    } catch {
                        hardware = false;
                    }
                    if (!this._destroyed && this._hardware.get(name) === null)
                        this._hardware.set(name, hardware);
                });
        }
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
            if (this.device_id === 'all')
                this._updateHardware(devices);
            // The first reading has nothing to compare with, so no rate yet.
            if (!last) {
                callback(null);
                return;
            }

            const sectors = {read: 0, write: 0};
            for (const [name, counters] of devices) {
                if (!this._counts(name))
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
