/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

'use strict';

import Gio from "gi://Gio";
import GLib from "gi://GLib";

function parse_bytearray(maybeBA) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(maybeBA);
}

function _check_sensors_sysfs(sensor_type) {
    const hwmon_path = '/sys/class/hwmon/';
    const hwmon_dir = Gio.file_new_for_path(hwmon_path);

    const sensors = {};

    function get_label_from(file) {
        if (file.query_exists(null)) {
            // load_contents (and even cat) fails with "Invalid argument" for some label files
            try {
                let [success, contents] = file.load_contents(null);
                if (success) {
                    // NOTE: contents of "name" and "*_label" files have a trailing newline
                    return parse_bytearray(contents).trim('\n');
                }
            } catch (e) {
                console.log(`error loading label from file ${file.get_path()}: ${e}`);
            }
        }
        return null;
    }

    function add_sensors_from(chip_dir, chip_label) {
        const chip_children = chip_dir.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (!chip_children) {
            console.log(`error enumerating children of chip ${chip_dir.get_path()}`);
            return false;
        }

        const input_entry_regex = new RegExp(`^${sensor_type}(\\d+)_input$`);
        let info;
        let added = false;
        while ((info = chip_children.next_file(null))) {
            if (info.get_file_type() !== Gio.FileType.REGULAR) {
                continue;
            }
            const matches = info.get_name().match(input_entry_regex);
            if (!matches) {
                continue;
            }
            const input_ordinal = matches[1];
            const input = chip_children.get_child(info);
            const input_label = get_label_from(chip_dir.get_child(`${sensor_type}${input_ordinal}_label`));

            const label = `${chip_label} - ${input_label || input_ordinal}`;
            sensors[label] = {sysfsPath: input.get_path()};
            added = true;
        }
        return added;
    }

    const hwmon_children = hwmon_dir.enumerate_children(
        'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    if (!hwmon_children) {
        console.log('error enumerating hwmon children');
        return {};
    }

    let info;
    while ((info = hwmon_children.next_file(null))) {
        if (info.get_file_type() !== Gio.FileType.DIRECTORY || !info.get_name().match(/^hwmon\d+$/)) {
            continue;
        }
        const chip = hwmon_children.get_child(info);
        const chip_label = get_label_from(chip.get_child('name')) || chip.get_basename();

        if (!add_sensors_from(chip, chip_label)) {
            // Some hwmon devices don't place their sensor files
            // into their "/sys/hwmon/hwmonN" directory, but into
            // the "device" sub directory instead. An example is the
            // Apple System Management Controller (kernel module "applesmc")
            // in Intel-based Macs.
            const device = chip.get_child('device');
            if (device.query_exists(null)) {
                const device_label = get_label_from(device.get_child('name')) || chip_label;
                add_sensors_from(device, device_label);
            }
        }
    }
    return sensors;
}

// A full `sensors -jA` sweep forks a subprocess and can take hundreds of
// milliseconds on slow SMBus hardware, and enumeration runs synchronously on
// the compositor thread from every thermal/fan widget constructor. Share one
// result across all of them (and across the temp/fan calls) instead of
// spawning per caller.
const SENSORS_ENUM_CACHE_US = 60 * 1e6;
let _sensors_json_cache;
let _sensors_json_cache_time = 0;

function _run_sensors_json() {
    const now = GLib.get_monotonic_time();
    if (_sensors_json_cache !== undefined && now - _sensors_json_cache_time < SENSORS_ENUM_CACHE_US)
        return _sensors_json_cache;
    let data = null;
    try {
        let [, stdout] = GLib.spawn_command_line_sync('sensors -jA');
        data = JSON.parse(new TextDecoder().decode(stdout));
    } catch {
        data = null;
    }
    _sensors_json_cache = data;
    _sensors_json_cache_time = now;
    return data;
}

function _check_sensors_lm(sensor_type) {
    let data = _run_sensors_json();
    if (!data)
        return null;

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

            let label = `${chipLabel} - ${sensorLabel}`;
            sensors[label] = {
                chip: chipName,
                sensorLabel: sensorLabel,
                rawKey: inputKey,
            };
        }
    }

    return Object.keys(sensors).length > 0 ? sensors : null;
}

function check_sensors(sensor_type) {
    const lm_sensors = _check_sensors_lm(sensor_type);
    const sysfs_sensors = _check_sensors_sysfs(sensor_type);
    if (!lm_sensors)
        return sysfs_sensors;
    // lm-sensors labels can differ from the sysfs ones for the same sensor
    // (e.g. "acpitz - temp1" vs "acpitz - 1"). Configs saved before
    // lm-sensors was installed -- including everything produced by the
    // v1->v2 settings migration -- store sysfs-style labels, so keep those
    // resolvable alongside the preferred lm-sensors entries.
    for (const [label, info] of Object.entries(sysfs_sensors)) {
        if (!(label in lm_sensors))
            lm_sensors[label] = info;
    }
    return lm_sensors;
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

export { parse_bytearray, check_sensors, read_sensor_async };
