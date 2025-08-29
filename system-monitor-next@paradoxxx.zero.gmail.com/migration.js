import Gio from "gi://Gio";

import { sm_log } from './utils.js';
import { check_sensors } from './common.js';

function migrateSettings(extension) {
    const SCHEMA_VERSION_KEY = 'settings-schema-version';
    const CURRENT_SCHEMA_VERSION = 2;  // Increment this when adding new migrations

    const settings = extension.getSettings();

    // Get current version, defaults to 0 if not set
    let currentVersion = settings.get_int(SCHEMA_VERSION_KEY);

    // Skip if we're already at the current version
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

    settings.set_int(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
}

function migrateFrom0(extension, newSettings) {
    // v0 -> v1
    // Handle schema name change by copying over all settings from old schema
    sm_log('Migrating settings: v0 -> v1');
    const OLD_SCHEMA_ID = 'org.gnome.shell.extensions.system-monitor';
    const oldSettings = extension.getSettings(OLD_SCHEMA_ID);

    if (!oldSettings) {
        sm_log('No old settings found, skipping migration from v0');
        return;
    }

    const keys = oldSettings.list_keys();

    for (const key of keys) {
        try {
            const value = oldSettings.get_value(key);
            if (value) {
                const unpackedValue = value.unpack();
                sm_log(`Migrating ${key}=${unpackedValue} from old schema`);
                newSettings.set_value(key, value);
            }
        } catch (e) {
            sm_log(`Error migrating key ${key}: ${e}`, 'error');
        }
    }

    sm_log('Successfully migrated settings from old schema');
}

function migrateFrom1(extension, settings) {
    sm_log('Migrating settings: v1 -> v2');

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

    function uuid() {
        return Gio.dbus_generate_guid();
    }

    for (const { type } of widgetTypes) {
        if (!settings.get_boolean(`${type}-display`)) {
            continue;
        }

        let devices;
        if (singletonWidgets.includes(type)) {
            devices = ['default'];
        } else {
            devices = settings.get_strv(`${type}-devices`);
            if (devices.length === 0) {
                if (type === 'thermal' || type === 'fan') {
                    const sensorType = type === 'thermal' ? 'temp' : 'fan';
                    devices = Object.keys(check_sensors(sensorType));
                    if (devices.length === 0) continue;
                } else {
                    devices = ['all'];
                }
            }
        }

        for (const device of devices) {
            const monitor = {
                uuid: uuid(),
                type: type,
                device: device,
                display: true,
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

            // Type-specific settings
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
    sm_log(`Successfully migrated ${monitors.length} monitors to new settings format.`);
    return true;
}


export { migrateSettings };