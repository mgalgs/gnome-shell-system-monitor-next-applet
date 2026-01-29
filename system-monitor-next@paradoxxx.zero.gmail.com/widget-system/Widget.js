/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import {sm_log} from '../utils.js';

/**
 * Base class for widgets in the widget system.
 * Widget authors extend this class and implement:
 * - static metadata - Widget configuration and metrics
 * - initialize() - Optional one-time setup
 * - collect() - Required data collection (sync or async)
 * - destroy() - Optional cleanup
 */
export class Widget {
    constructor(extension, config, renderer, scheduler) {
        this.extension = extension;
        this.config = config;
        this.renderer = renderer;
        this.scheduler = scheduler;

        // Validate metadata
        if (!this.constructor.metadata) {
            throw new Error(`Widget ${this.constructor.name} must define static metadata`);
        }

        const {id, name, metrics} = this.constructor.metadata;
        if (!id) {
            throw new Error(`Widget ${this.constructor.name} metadata must include 'id'`);
        }
        if (!name) {
            throw new Error(`Widget ${this.constructor.name} metadata must include 'name'`);
        }
        if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
            throw new Error(`Widget ${this.constructor.name} metadata must include 'metrics' array`);
        }

        this.id = id;
        this.metadata = this.constructor.metadata;

        // Validate metric definitions
        for (const metric of metrics) {
            if (!metric.key) {
                throw new Error(`Widget ${this.constructor.name} has metric without 'key'`);
            }
            if (!metric.label) {
                throw new Error(`Widget ${this.constructor.name} metric '${metric.key}' missing 'label'`);
            }
        }
    }

    /**
     * One-time initialization. Override in subclass if needed.
     * Called after construction but before first collect().
     */
    initialize() {
        // Override in subclass
    }

    /**
     * Collect current metric values. Must be implemented by subclass.
     *
     * @returns {Object} Object with keys matching metric definitions.
     *                   Values should be the current measurements.
     *                   For graphing, include _normalized field with 0.0-1.0 values.
     *                   Example: { program: 512, buffer: 128, cache: 256, _normalized: { program: 0.5, buffer: 0.125, cache: 0.25 } }
     */
    collect() {
        throw new Error(`Widget ${this.constructor.name} must implement collect()`);
    }

    /**
     * Cleanup resources. Override in subclass if needed.
     */
    destroy() {
        // Override in subclass for cleanup
    }

    /**
     * Get the widget's unique identifier.
     */
    getId() {
        return this.id;
    }

    /**
     * Get the widget's display name (i18n-ready).
     */
    getName() {
        return this.metadata.name;
    }

    /**
     * Get the widget's metric definitions.
     */
    getMetrics() {
        return this.metadata.metrics;
    }
}
