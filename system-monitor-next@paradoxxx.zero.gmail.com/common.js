/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

'use strict';

import Gio from "gi://Gio";
import GLib from "gi://GLib";

function parse_bytearray(maybeBA) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(maybeBA);
}

/**
 * Does I/O to this block device reach storage attached to this machine?
 *
 * The block layer accounts a request at every device it traverses, so
 * /proc/diskstats records one write on the logical volume, again on the
 * encrypted device under it, again on the partition, and again on the disk. A
 * total that wants each write once wants the last of those.
 *
 * The kernel answers directly: `device` is the symlink the block layer creates
 * from a *gendisk* to its parent in the driver model. A partition is not a
 * gendisk, so no partition has one; a virtual block driver -- device-mapper,
 * md, loop, nbd, zram -- registers its gendisk with no parent, because there is
 * no hardware to point at, so no layer above a medium has one either.
 *
 * /sys/class/block rather than /sys/block: /sys/block holds whole devices only,
 * so it would reject partitions by path absence and layers by link absence, two
 * mechanisms wearing one expression. /sys/class/block holds every row of
 * /proc/diskstats -- measured, in both directions -- so the one clause does
 * both rejections for the one reason above.
 *
 * Named for the role rather than for the link that answers it, and deliberately
 * not `edge`, the word the net reading uses for the same shape: an nbd device
 * IS where disk I/O leaves this machine, and it is exactly what this excludes.
 *
 * Measured at 3.06 us per device, and never memoised by name -- `dm-0` is
 * whichever mapping was created first and `loop3` is whichever snap mounted
 * third, so a memo would be quietly wrong the moment a name was reused.
 *
 * @param {string} device - a /proc/diskstats device name
 * @returns {boolean}
 */
function is_storage_medium(device) {
    return GLib.file_test(`/sys/class/block/${device}/device`, GLib.FileTest.EXISTS);
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
        let info;
        let added = false;
        while ((info = chip_children.next_file(null))) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const matches = info.get_name().match(input_entry_regex);
            if (!matches)
                continue;
            const input_ordinal = matches[1];
            const input = chip_children.get_child(info);
            const label_file = chip_dir.get_child(`${sensor_type}${input_ordinal}_label`);

            added = true;
            read_label_async(label_file, input_label => {
                const label = `${chip_label} - ${input_label || input_ordinal}`;
                sensors[label] = {sysfsPath: input.get_path()};
            });
        }
        done(added);
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
            add_sensors_from(chip, chip_label, added => {
                if (!added) {
                    const device = chip.get_child('device');
                    if (device.query_exists(null)) {
                        read_label_async(device.get_child('name'), dev_label => {
                            add_sensors_from(device, dev_label || chip_label, () => chip_finished());
                        });
                        return;
                    }
                }
                chip_finished();
            });
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

function _merge_sensors(lm_sensors, sysfs_sensors) {
    if (!lm_sensors)
        return sysfs_sensors;
    for (const [label, info] of Object.entries(sysfs_sensors)) {
        if (!(label in lm_sensors))
            lm_sensors[label] = info;
    }
    return lm_sensors;
}

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

                let label = `${chipLabel} - ${sensorLabel}`;
                sensors[label] = {chip: chipName, sensorLabel, rawKey: inputKey};
            }
        }

        callback(Object.keys(sensors).length > 0 ? sensors : null);
    });
}

function check_sensors_async(sensor_type, callback) {
    _check_sensors_lm_async(sensor_type, lm_sensors => {
        _check_sensors_sysfs_async(sensor_type, sysfs_sensors => {
            callback(_merge_sensors(lm_sensors, sysfs_sensors));
        });
    });
}

// A sensor named by chip comes out of the shared `sensors -jA` reading, so one
// spawn serves every widget on the panel however many chips they span. A sensor
// named by sysfs path is genuinely one file per sensor and is read directly.
function read_sensor_async(cursor, sensorInfo, callback) {
    if (sensorInfo.chip) {
        cursor.sample(reading => {
            let value = reading?.data?.[sensorInfo.chip]?.[sensorInfo.sensorLabel]?.[sensorInfo.rawKey];
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

export { parse_bytearray, is_storage_medium, check_sensors_async, read_sensor_async };
