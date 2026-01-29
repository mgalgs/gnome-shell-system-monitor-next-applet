/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import {sm_log} from '../utils.js';

/**
 * Settings adapter that provides type-safe, prefixed access to GSettings.
 * Automatically prefixes keys with '{widgetId}-'.
 */
export class WidgetSettingsAdapter {
    constructor(schema, widgetId) {
        this._schema = schema;
        this._widgetId = widgetId;
        this._connections = new Map();
    }

    /**
     * Build a prefixed settings key.
     *
     * @param {string} key - Base key name
     * @returns {string} Prefixed key (e.g., 'memory-refresh-time')
     */
    _prefixed(key) {
        return `${this._widgetId}-${key}`;
    }

    /**
     * Get an integer value.
     *
     * @param {string} key - Setting key (without prefix)
     * @returns {number} Integer value
     */
    getInt(key) {
        return this._schema.get_int(this._prefixed(key));
    }

    /**
     * Get a boolean value.
     *
     * @param {string} key - Setting key (without prefix)
     * @returns {boolean} Boolean value
     */
    getBoolean(key) {
        return this._schema.get_boolean(this._prefixed(key));
    }

    /**
     * Get a string value.
     *
     * @param {string} key - Setting key (without prefix)
     * @returns {string} String value
     */
    getString(key) {
        return this._schema.get_string(this._prefixed(key));
    }

    /**
     * Get a color value as string.
     *
     * @param {string} metricKey - Metric key (e.g., 'program')
     * @returns {string} Color value (e.g., '#0000ff')
     */
    getColor(metricKey) {
        return this._schema.get_string(this._prefixed(`${metricKey}-color`));
    }

    /**
     * Get an enum value.
     *
     * @param {string} key - Setting key (without prefix)
     * @returns {number} Enum value
     */
    getEnum(key) {
        return this._schema.get_enum(this._prefixed(key));
    }

    /**
     * Connect to a setting change.
     *
     * @param {string} key - Setting key (without prefix)
     * @param {Function} callback - Callback function(schema, key)
     * @returns {number} Signal connection ID
     */
    onChange(key, callback) {
        const signalId = this._schema.connect(`changed::${this._prefixed(key)}`, callback);
        this._connections.set(key, signalId);
        return signalId;
    }

    /**
     * Disconnect a specific signal.
     *
     * @param {number} signalId - Signal connection ID
     */
    disconnect(signalId) {
        this._schema.disconnect(signalId);

        // Remove from tracking
        for (const [key, id] of this._connections.entries()) {
            if (id === signalId) {
                this._connections.delete(key);
                break;
            }
        }
    }

    /**
     * Disconnect all signals for this adapter.
     */
    disconnectAll() {
        for (const signalId of this._connections.values()) {
            this._schema.disconnect(signalId);
        }
        this._connections.clear();
    }

    /**
     * Check if a key exists in the schema.
     *
     * @param {string} key - Setting key (without prefix)
     * @returns {boolean} True if key exists
     */
    hasKey(key) {
        return this._schema.settings_schema.has_key(this._prefixed(key));
    }
}
