/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

'use strict';

import Gio from "gi://Gio";
import GLib from "gi://GLib";

function parse_bytearray(maybeBA) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(maybeBA);
}

// hwmon chips expose a `device` symlink pointing at the underlying device node.
// Returns the symlink basename when it names a block device (nvme0, sda, mmcblk0,
// vda), or null when there is no symlink / it is not a disk-like name.
// Only disk-like names are used: thermal chips symlink to thermal zones, GPU and
// battery devices to unrelated nodes, and those basenames are no better than the
// chip's own `name` file.
function _device_label_for(chip_dir) {
    const device_path = chip_dir.get_child('device').get_path();
    // GLib.file_read_link returns the raw symlink target (e.g. "../../nvme0");
    // Gio.File.query_symlink_target / unix::symlink are not usable on this GJS.
    let target = null;
    try {
        target = GLib.file_read_link(device_path);
    } catch {
        return null;
    }
    if (!target)
        return null;
    const basename = target.split('/').pop();
    return /^(nvme\d+|sd[a-z]+|mmcblk\d+|vd[a-z]+)$/.test(basename) ? basename : null;
}

function _check_sensors_sysfs_async(sensor_type, callback) {
    const hwmon_path = '/sys/class/hwmon/';
    const hwmon_dir = Gio.file_new_for_path(hwmon_path);

    const sensors = {};
    let pending_labels = 0;
    let enumeration_done = false;

    function maybe_finish() {
        if (enumeration_done && pending_labels === 0)
            callback(sensors);
    }

    function read_label_async(file, cb) {
        if (!file.query_exists(null)) {
            cb(null);
            return;
        }
        pending_labels++;
        file.load_contents_async(null, (source, result) => {
            let label = null;
            try {
                let [success, contents] = source.load_contents_finish(result);
                if (success)
                    label = parse_bytearray(contents).trim('\n');
            } catch { /* some label files fail with "Invalid argument" */ }
            pending_labels--;
            cb(label);
            maybe_finish();
        });
    }

    function add_sensors_from(chip_dir, chip_label, done) {
        const chip_children = chip_dir.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (!chip_children) {
            done(false);
            return;
        }

        const input_entry_regex = new RegExp(`^${sensor_type}(\\d+)_input$`);

        // Collect all sensor info first, so the enumerator is fully consumed before
        // any async label read resolves.
        let sensorInfos = [];
        let info;
        while ((info = chip_children.next_file(null))) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const matches = info.get_name().match(input_entry_regex);
            if (!matches)
                continue;
            const input_ordinal = matches[1];
            const input = chip_dir.get_child(info.get_name());
            const label_file = chip_dir.get_child(`${sensor_type}${input_ordinal}_label`);
            sensorInfos.push({input, label_file, input_ordinal});
        }
        chip_children.close(null);

        if (sensorInfos.length === 0) {
            done(false);
            return;
        }

        // A hwmon chip's `device` symlink names the underlying device. Several chips of
        // the same driver share an identical `name` file (both NVMe drives report "nvme"),
        // so the symlink basename (nvme0, nvme1) is what keeps them apart.
        const deviceLabel = _device_label_for(chip_dir) || chip_label;

        sensorInfos.forEach(({input, label_file, input_ordinal}) => {
            read_label_async(label_file, input_label => {
                // Match the lm-sensors "chipLabel - sensorLabel" shape, falling back to the
                // full sensor name (temp1) rather than a bare ordinal.
                const label = `${deviceLabel} - ${input_label || `${sensor_type}${input_ordinal}`}`;
                sensors[label] = {sysfsPath: input.get_path()};
            });
        });
        done(true);
    }

    const hwmon_children = hwmon_dir.enumerate_children(
        'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    if (!hwmon_children) {
        callback({});
        return;
    }

    let chips_pending = 0;
    let chips_done = false;

    function chip_finished() {
        chips_pending--;
        if (chips_done && chips_pending === 0) {
            enumeration_done = true;
            maybe_finish();
        }
    }

    let chip_info;
    while ((chip_info = hwmon_children.next_file(null))) {
        if (chip_info.get_file_type() !== Gio.FileType.DIRECTORY || !chip_info.get_name().match(/^hwmon\d+$/))
            continue;
        const chip = hwmon_children.get_child(chip_info);
        chips_pending++;
        read_label_async(chip.get_child('name'), chip_label => {
            chip_label = chip_label || chip.get_basename();
            add_sensors_from(chip, chip_label, () => chip_finished());
        });
    }
    chips_done = true;
    if (chips_pending === 0) {
        enumeration_done = true;
        maybe_finish();
    }
}

const SENSORS_ENUM_CACHE_US = 60 * 1e6;
let _sensors_json_cache;
let _sensors_json_cache_time = 0;

function _run_sensors_json_async(callback) {
    const now = GLib.get_monotonic_time();
    if (_sensors_json_cache !== undefined && now - _sensors_json_cache_time < SENSORS_ENUM_CACHE_US) {
        callback(_sensors_json_cache);
        return;
    }
    try {
        let proc = new Gio.Subprocess({
            argv: ['sensors', '-jA'],
            flags: Gio.SubprocessFlags.STDOUT_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, result) => {
            let data = null;
            try {
                let [, output] = p.communicate_utf8_finish(result);
                data = JSON.parse(output);
            } catch {
                data = null;
            }
            _sensors_json_cache = data;
            _sensors_json_cache_time = GLib.get_monotonic_time();
            callback(data);
        });
    } catch {
        _sensors_json_cache = null;
        _sensors_json_cache_time = GLib.get_monotonic_time();
        callback(null);
    }
}

function _check_sensors_lm_async(sensor_type, callback) {
    _run_sensors_json_async(data => {
        if (!data) {
            callback(null);
            return;
        }

        const inputRegex = new RegExp(`^${sensor_type}\\d+_input$`);
        const driverCounts = {};
        for (let chipName of Object.keys(data)) {
            let driver = chipName.split('-')[0];
            driverCounts[driver] = (driverCounts[driver] || 0) + 1;
        }

        const sensors = {};
        for (let [chipName, chipSensors] of Object.entries(data)) {
            let driver = chipName.split('-')[0];
            let chipLabel = driverCounts[driver] > 1 ? chipName : driver;

            for (let [sensorLabel, sensorData] of Object.entries(chipSensors)) {
                if (typeof sensorData !== 'object')
                    continue;
                let inputKey = Object.keys(sensorData).find(k => inputRegex.test(k));
                if (!inputKey)
                    continue;

                // When there are multiple chips with the same driver, chipName is already unique
                // (e.g., nvme-pci-e100, nvme-pci-e200), so we don't need to add hwmonId
                // When there's only one chip, chipLabel is just the driver name (e.g., nvme)
                let label = `${chipLabel} - ${sensorLabel}`;
                sensors[label] = {chip: chipName, sensorLabel, rawKey: inputKey};
            }
        }

        callback(Object.keys(sensors).length > 0 ? sensors : null);
    });
}

function check_sensors_async(sensor_type, callback) {
    // Use lm-sensors if available, otherwise fall back to sysfs
    _check_sensors_lm_async(sensor_type, lm_sensors => {
        if (lm_sensors && Object.keys(lm_sensors).length > 0) {
            callback(lm_sensors);
        } else {
            _check_sensors_sysfs_async(sensor_type, sysfs_sensors => {
                callback(sysfs_sensors);
            });
        }
    });
}

// Several widgets polling sensors on the same chip would each fork their own
// `sensors` subprocess every refresh tick. Coalesce concurrent reads and
// briefly cache the result so one spawn serves all widgets on that chip.
const CHIP_READ_CACHE_MS = 1000;
const _chip_reads = new Map();

function _read_chip_async(chip, callback) {
    let entry = _chip_reads.get(chip);
    if (entry) {
        if (entry.pending) {
            entry.pending.push(callback);
            return;
        }
        if (GLib.get_monotonic_time() / 1000 - entry.time < CHIP_READ_CACHE_MS) {
            callback(entry.data);
            return;
        }
    }
    entry = {pending: [callback]};
    _chip_reads.set(chip, entry);
    const finish = data => {
        entry.time = GLib.get_monotonic_time() / 1000;
        entry.data = data;
        const callbacks = entry.pending;
        entry.pending = null;
        for (const cb of callbacks)
            cb(data);
    };
    try {
        let proc = new Gio.Subprocess({
            argv: ['sensors', '-jA', chip],
            flags: Gio.SubprocessFlags.STDOUT_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, result) => {
            try {
                let [, output] = p.communicate_utf8_finish(result);
                finish(JSON.parse(output)[chip] ?? null);
            } catch {
                finish(null);
            }
        });
    } catch {
        finish(null);
    }
}

function read_sensor_async(sensorInfo, callback) {
    if (sensorInfo.chip) {
        _read_chip_async(sensorInfo.chip, chipData => {
            let value = chipData?.[sensorInfo.sensorLabel]?.[sensorInfo.rawKey];
            if (value === undefined) {
                callback(null);
                return;
            }
            if (sensorInfo.rawKey.startsWith('temp'))
                callback(Math.round(value * 1000));
            else
                callback(Math.round(value));
        });
    } else if (sensorInfo.sysfsPath) {
        let file = Gio.file_new_for_path(sensorInfo.sysfsPath);
        if (!file.query_exists(null)) {
            callback(null);
            return;
        }
        file.load_contents_async(null, (source, result) => {
            try {
                let [, contents] = source.load_contents_finish(result);
                callback(parseInt(parse_bytearray(contents)));
            } catch {
                callback(null);
            }
        });
    } else {
        callback(null);
    }
}

export { parse_bytearray, check_sensors_async, read_sensor_async };
