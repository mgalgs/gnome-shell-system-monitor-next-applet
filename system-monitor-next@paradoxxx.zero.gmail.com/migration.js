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
    // Previously, this handled the schema name change by copying over all
    // settings from old schema. But since the old schema filename was
    // clashing with a standard gnome-shell extension
    // (gnome-shell-extension-system-monitor) we had to get rid of
    // it. Existing users have had ~6 months to update. Anyone who missed
    // this update window will lose their customizations. Not a huge deal,
    // resolving the filename conflict is the priority at this point.
    return true;
}

export { migrateSettings };
