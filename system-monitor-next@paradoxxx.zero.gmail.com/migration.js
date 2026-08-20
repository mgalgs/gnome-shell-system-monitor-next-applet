import Gio from "gi://Gio";
import GTop from "gi://GTop";

import { sm_log } from './utils.js';

function migrateSettings(extension) {
    const SCHEMA_VERSION_KEY = 'settings-schema-version';
    const CURRENT_SCHEMA_VERSION = 3;

    const settings = extension.getSettings();
    let currentVersion = settings.get_int(SCHEMA_VERSION_KEY);

    if (currentVersion === CURRENT_SCHEMA_VERSION) {
        return;
    }

    sm_log(`Migrating settings from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`);

    if (currentVersion < 1) {
        migrateFrom0(extension, settings);
        currentVersion = 1;
    }

    if (currentVersion < 2) {
        migrateFrom1(extension, settings);
        currentVersion = 2;
    }

    if (currentVersion < 3) {
        migrateFrom2(extension, settings);
        currentVersion = 3;
    }

    settings.set_int(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
}

function migrateFrom0(_extension, _settings) {
    // v0 -> v1: previously handled old schema name migration.
    // The old schema has been removed; this is now a no-op.
    return true;
}

function migrateFrom1(extension, settings) {
    sm_log('Migrating settings: v1 -> v2 (creating monitors config)');

    const monitors = [];
    const widgetTypes = [
        { type: 'cpu', pos: settings.get_int('cpu-position') },
        { type: 'freq', pos: settings.get_int('freq-position') },
        { type: 'memory', pos: settings.get_int('memory-position') },
        { type: 'swap', pos: settings.get_int('swap-position') },
        { type: 'net', pos: settings.get_int('net-position') },
        { type: 'disk', pos: settings.get_int('disk-position') },
        { type: 'gpu', pos: settings.get_int('gpu-position') },
        { type: 'thermal', pos: settings.get_int('thermal-position') },
        { type: 'fan', pos: settings.get_int('fan-position') },
        { type: 'battery', pos: settings.get_int('battery-position') },
    ];

    widgetTypes.sort((a, b) => a.pos - b.pos);

    const colorMap = {
        cpu: ['user', 'system', 'nice', 'iowait', 'other'],
        memory: ['program', 'buffer', 'cache'],
        swap: ['used'],
        net: ['down', 'downerrors', 'up', 'uperrors', 'collisions'],
        disk: ['read', 'write'],
        gpu: ['used', 'memory'],
        thermal: ['tz0'],
        fan: ['fan0'],
        battery: ['batt0'],
        freq: ['freq'],
    };

    const singletonWidgets = ['memory', 'swap', 'battery'];

    for (const { type } of widgetTypes) {
        let devices;
        if (type === 'cpu' && settings.get_boolean('cpu-individual-cores')) {
            const coreCount = GTop.glibtop_get_sysinfo().ncpu;
            devices = Array.from({ length: coreCount }, (_, i) => i.toString());
        } else if (type === 'cpu') {
            devices = ['all'];
        } else if (type === 'freq') {
            devices = ['all'];
        } else if (singletonWidgets.includes(type)) {
            devices = ['default'];
        } else if (type === 'thermal' || type === 'fan') {
            devices = [settings.get_string(`${type}-sensor-label`) || ''];
        } else {
            // net, disk, gpu: default to 'all' or '0'
            if (type === 'gpu') {
                devices = ['0'];
            } else {
                devices = ['all'];
            }
        }

        for (const device of devices) {
            const monitor = {
                uuid: Gio.dbus_generate_guid(),
                type: type,
                device: device,
                display: settings.get_boolean(`${type}-display`),
                style: settings.get_string(`${type}-style`),
                'graph-width': settings.get_int(`${type}-graph-width`),
                'refresh-time': settings.get_int(`${type}-refresh-time`),
                'show-text': settings.get_boolean(`${type}-show-text`),
                'show-menu': settings.get_boolean(`${type}-show-menu`),
                colors: {},
            };

            if (colorMap[type]) {
                for (const colorName of colorMap[type]) {
                    monitor.colors[colorName] = settings.get_string(`${type}-${colorName}-color`);
                }
            }

            if (type === 'thermal') {
                monitor['fahrenheit-unit'] = settings.get_boolean('thermal-fahrenheit-unit');
                monitor['threshold'] = settings.get_int('thermal-threshold');
            }
            if (type === 'net') {
                monitor['speed-in-bits'] = settings.get_boolean('net-speed-in-bits');
            }
            if (type === 'battery') {
                monitor['time'] = settings.get_boolean('battery-time');
                monitor['hidesystem'] = settings.get_boolean('battery-hidesystem');
            }
            if (type === 'freq') {
                monitor['display-mode'] = settings.get_string('freq-display-mode');
            }

            monitors.push(JSON.stringify(monitor));
        }
    }

    settings.set_strv('monitors', monitors);
    sm_log(`Successfully migrated ${monitors.length} monitors to new config format.`);
}

// Sorts object keys at every level so two configs holding the same settings
// compare equal regardless of the order their fields were written in. Plain
// JSON.stringify would compare serialization, and hand-authored configs are a
// supported input.
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort())
            sorted[key] = canonical(value[key]);
        return sorted;
    }
    return value;
}

// Everything that must match for two monitors to be the same monitor watching
// a different device. `type` is included, so an equal fingerprint already
// implies an equal type.
function settingsFingerprint(config) {
    const settings = {...config};
    delete settings.uuid;
    delete settings.device;
    return JSON.stringify(canonical(settings));
}

function toDeviceEntry(config) {
    const entry = {id: config.device};
    // show-text is per-device from v3 on: a widget's label belongs to the
    // widget, and one monitor now produces several.
    if ('show-text' in config)
        entry['show-text'] = config['show-text'];
    return entry;
}

function migrateFrom2(_extension, settings) {
    sm_log('Migrating settings: v2 -> v3 (monitor device becomes a device set)');

    const raw = settings.get_strv('monitors');
    const parsed = [];
    for (const s of raw) {
        try {
            const config = JSON.parse(s);
            if (config && config.uuid && config.type)
                parsed.push(config);
            else
                sm_log('Passing over a monitor with no uuid and type during v2 -> v3 migration', 'warn');
        } catch (e) {
            sm_log(`Passing over a malformed monitor during v2 -> v3 migration: ${e.message}`, 'warn');
        }
    }

    // A user who had individual CPU cores enabled before the v1 -> v2 migration
    // owns one monitor per core. Merge a run of adjacent monitors that differ
    // only in uuid and device back into one entry -- that split is the very
    // thing a device set exists to undo. Adjacency matters: same-type monitors
    // placed apart in the list were placed apart deliberately.
    const runs = [];
    for (const config of parsed) {
        // Nothing to convert and nothing to guess: pass it through untouched so
        // the user still has it to fix, and let it break the run.
        if (typeof config.device !== 'string' || Array.isArray(config.devices)) {
            runs.push({config, fingerprint: null, merged: 0});
            continue;
        }

        const fingerprint = settingsFingerprint(config);
        const previous = runs[runs.length - 1];
        if (previous && previous.fingerprint === fingerprint) {
            previous.config.devices.push(toDeviceEntry(config));
            previous.merged++;
            continue;
        }

        const converted = {...config, devices: [toDeviceEntry(config)]};
        delete converted.device;
        delete converted['show-text'];
        runs.push({config: converted, fingerprint, merged: 0});
    }

    for (const run of runs) {
        if (run.merged > 0) {
            sm_log(`Merged ${run.merged + 1} adjacent ${run.config.type} monitors into 1 with ` +
                   `${run.config.devices.length} devices`);
        }
    }

    settings.set_strv('monitors', runs.map(run => JSON.stringify(run.config)));
    sm_log(`Migrated ${parsed.length} monitors to ${runs.length} device sets`);
}

export { migrateSettings };
