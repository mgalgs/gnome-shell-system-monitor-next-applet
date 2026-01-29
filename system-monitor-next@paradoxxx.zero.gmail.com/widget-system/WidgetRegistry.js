/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import {sm_log} from '../utils.js';

/**
 * Registry for widgets in the widget system.
 * Manages widget registration, lookup, and instantiation.
 */
export class WidgetRegistry {
    constructor() {
        this._widgets = new Map();
    }

    /**
     * Register a widget class.
     *
     * @param {class} WidgetClass - Widget class extending Widget base class
     */
    register(WidgetClass) {
        if (!WidgetClass.metadata) {
            throw new Error(`Cannot register widget ${WidgetClass.name}: missing static metadata`);
        }

        const {id} = WidgetClass.metadata;
        if (!id) {
            throw new Error(`Cannot register widget ${WidgetClass.name}: metadata missing 'id'`);
        }

        if (this._widgets.has(id)) {
            sm_log(`Widget '${id}' is already registered, overwriting`, 'warn');
        }

        this._widgets.set(id, WidgetClass);
        sm_log(`Registered widget: ${id}`);
    }

    /**
     * Check if a widget is available.
     *
     * @param {string} widgetId - Widget identifier
     * @returns {boolean} True if widget is registered
     */
    isAvailable(widgetId) {
        return this._widgets.has(widgetId);
    }

    /**
     * Create a widget instance.
     *
     * @param {string} widgetId - Widget identifier
     * @param {Object} extension - Extension instance
     * @param {Object} config - Settings adapter
     * @param {Object} renderer - Widget renderer
     * @param {Object} scheduler - Widget scheduler
     * @returns {Widget} Widget instance
     * @throws {Error} If widget not found
     */
    create(widgetId, extension, config, renderer, scheduler) {
        const WidgetClass = this._widgets.get(widgetId);
        if (!WidgetClass) {
            throw new Error(`Widget '${widgetId}' not found in registry`);
        }

        return new WidgetClass(extension, config, renderer, scheduler);
    }

    /**
     * Get all registered widget IDs.
     *
     * @returns {string[]} Array of widget IDs
     */
    list() {
        return Array.from(this._widgets.keys());
    }

    /**
     * Unregister all widgets.
     */
    clear() {
        this._widgets.clear();
    }
}

// Export a singleton instance for global registry
export const widgetRegistry = new WidgetRegistry();
