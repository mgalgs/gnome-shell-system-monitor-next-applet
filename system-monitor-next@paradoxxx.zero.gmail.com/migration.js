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
    const oldSettings = getOldSettings(extension);

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

// Ripped from gnome-shell source, but hard-coded the old_schemas directory
// and dropped support for loading from the system directory (since our
// old schema won't be present in a system install), which means
// that settings migration likely won't work for system installs :'(
function getOldSettings(extension) {
    const OLD_SCHEMA_ID = 'org.gnome.shell.extensions.system-monitor';

    const schemaDir = extension.dir.get_child('old_schemas');
    if (!schemaDir.query_exists(null)) {
        sm_log('No old schemas directory found, skipping migration');
        return null;
    }

    const defaultSource = Gio.SettingsSchemaSource.get_default();
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        schemaDir.get_path(), defaultSource, false);

    const schemaObj = schemaSource.lookup(OLD_SCHEMA_ID, true);
    if (!schemaObj) {
        sm_log('No old schema found, skipping migration');
        return null;
    }

    return new Gio.Settings({settings_schema: schemaObj});
}

export { migrateSettings };
