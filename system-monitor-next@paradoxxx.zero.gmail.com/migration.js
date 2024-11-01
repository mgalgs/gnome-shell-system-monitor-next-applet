import Gio from "gi://Gio";

import { sm_log } from './utils.js';

function migrateSettings(extension) {
    const SCHEMA_VERSION_KEY = 'settings-schema-version';
    const CURRENT_SCHEMA_VERSION = 1;  // Increment this when adding new migrations

    const settings = extension.getSettings();

    // Get current version, defaults to 0 if not set
    const currentVersion = settings.get_int(SCHEMA_VERSION_KEY);

    // Skip if we're already at the current version
    if (currentVersion === CURRENT_SCHEMA_VERSION) {
        sm_log("No settings migration needed");
        return;
    }

    let didMigration = false;

    switch (currentVersion) {
        case 0:
            didMigration = migrateFrom0(extension, settings);
            break;
        default:
            sm_log(`Unknown schema version ${currentVersion}`);
            break;
    }

    if (!didMigration) {
        const msg = `BOGUS schema migration! No migration was performed, but current version is ${currentVersion} and desired version is ${CURRENT_SCHEMA_VERSION}.`;
        sm_log(msg, 'error');
    } else {
        settings.set_int(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
    }
}

function migrateFrom0(extension, newSettings) {
    // v0 -> v1
    // Handle schema name change by copying over all settings from old schema
    sm_log('Migrating settings: v0 -> v1');
    const OLD_SCHEMA_ID = 'org.gnome.shell.extensions.system-monitor';
    const oldSettings = extension.getSettings(OLD_SCHEMA_ID);

    if (!oldSettings) {
        sm_log('No old settings found, skipping migration');
        // Migration is successful, but no settings were migrated
        return true;
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
    return true;
}

export { migrateSettings };
