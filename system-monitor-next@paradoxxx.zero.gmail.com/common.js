/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

'use strict';

import Gio from "gi://Gio";
import GLib from "gi://GLib";

function parse_bytearray(maybeBA) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(maybeBA);
}

/**
 * Whether a GLib source id still refers to a live source on the default main
 * context. GJS refuses to enter JS while the GC is sweeping, and a refused
 * SourceFunc yields no return value, which GLib reads as G_SOURCE_REMOVE — so
 * a source can be destroyed without the extension ever being told. Anything
 * holding a source id has to be able to ask.
 *
 * Lives here rather than in base.js so that prefs.js — a separate process
 * that cannot import base.js, since that pulls in shell-only UI modules —
 * can use it too.
 *
 * id - GLib source id, or a falsy value
 */
function source_is_alive(id) {
    if (!id)
        return false;
    return GLib.MainContext.default().find_source_by_id(id) !== null;
}

/**
 * Removes a GLib source only if it is still alive, so that a source already
 * destroyed behind our back does not produce a "Source ID N was not found when
 * attempting to remove it" critical.
 *
 * id - GLib source id, or a falsy value
 */
function source_remove_if_alive(id) {
    if (source_is_alive(id))
        GLib.Source.remove(id);
}

// Discriminator for a chip whose `name` collides with another chip of the same
// sensor type. The `device` symlink names the underlying device node (nvme0 for
// a drive, 0000:c1:00.0 for a GPU), which is both unique and stable across
// reboots; the hwmon directory name is the fallback when there is no symlink.
function _chip_discriminator(chip_dir) {
    let target = null;
    try {
        // GLib.file_read_link returns the raw symlink target (e.g. "../../nvme0");
        // Gio.File.query_symlink_target / unix::symlink are not usable on this GJS.
        target = GLib.file_read_link(chip_dir.get_child('device').get_path());
    } catch { /* no device symlink */ }
    return target ? target.split('/').pop() : chip_dir.get_basename();
}

function _check_sensors_sysfs_async(sensor_type, callback) {
    const hwmon_path = '/sys/class/hwmon/';
    const hwmon_dir = Gio.file_new_for_path(hwmon_path);

    const sensors = {};
    let pending_labels = 0;
    let enumeration_done = false;
    let finished = false;

    function maybe_finish() {
        if (finished || !enumeration_done || pending_labels > 0)
            return;
        finished = true;
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

    // Enumerate this chip's sensors of the requested type. Returns [] when the
    // chip exposes none.
    function collect_sensors(chip_dir) {
        const chip_children = chip_dir.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (!chip_children)
            return [];

        const input_entry_regex = new RegExp(`^${sensor_type}(\\d+)_input$`);
        const found = [];
        let info;
        while ((info = chip_children.next_file(null))) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const matches = info.get_name().match(input_entry_regex);
            if (!matches)
                continue;
            const input_ordinal = matches[1];
            found.push({
                input: chip_dir.get_child(info.get_name()),
                label_file: chip_dir.get_child(`${sensor_type}${input_ordinal}_label`),
                input_ordinal,
            });
        }
        chip_children.close(null);
        return found;
    }

    const hwmon_children = hwmon_dir.enumerate_children(
        'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    if (!hwmon_children) {
        callback({});
        return;
    }

    // Pass 1 reads every chip's name and sensor list before pass 2 emits any
    // label, so a name collision can gate the discriminator. Labels are
    // persisted verbatim into config.device and re-matched on every collect,
    // so a chip that does not collide must keep the bare name it has always
    // had or existing configs silently break.
    const chips = [];
    let chips_pending = 0;
    let chips_done = false;

    function chip_finished() {
        chips_pending--;
        if (!(chips_done && chips_pending === 0))
            return;

        const name_counts = {};
        for (const chip of chips)
            name_counts[chip.name] = (name_counts[chip.name] || 0) + 1;

        for (const chip of chips) {
            const chip_label = name_counts[chip.name] > 1
                ? _chip_discriminator(chip.dir)
                : chip.name;
            for (const {input, label_file, input_ordinal} of chip.sensors) {
                read_label_async(label_file, input_label => {
                    const label = `${chip_label} - ${input_label || input_ordinal}`;
                    sensors[label] = {sysfsPath: input.get_path()};
                });
            }
        }
        enumeration_done = true;
        maybe_finish();
    }

    let chip_info;
    while ((chip_info = hwmon_children.next_file(null))) {
        if (chip_info.get_file_type() !== Gio.FileType.DIRECTORY || !chip_info.get_name().match(/^hwmon\d+$/))
            continue;
        const chip = hwmon_children.get_child(chip_info);
        const chip_sensors = collect_sensors(chip);
        if (chip_sensors.length === 0)
            continue;
        chips_pending++;
        read_label_async(chip.get_child('name'), chip_label => {
            chips.push({dir: chip, name: chip_label || chip.get_basename(), sensors: chip_sensors});
            chip_finished();
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

// Runtime lookup for a persisted config.device label. Includes sysfs labels
// lm-sensors lacks, because the Add Monitor dialog used to offer sysfs labels
// only and configs saved from it must keep matching.
function check_sensors_async(sensor_type, callback) {
    _check_sensors_lm_async(sensor_type, lm_sensors => {
        _check_sensors_sysfs_async(sensor_type, sysfs_sensors => {
            callback({...sysfs_sensors, ...lm_sensors});
        });
    });
}

// Sensors to offer in the Add Monitor dialog: one source per sensor type, so
// a chip isn't listed under both its lm-sensors and its sysfs label.
function list_sensors_async(sensor_type, callback) {
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

export { parse_bytearray, source_is_alive, source_remove_if_alive, check_sensors_async, list_sensors_async, read_sensor_async };
