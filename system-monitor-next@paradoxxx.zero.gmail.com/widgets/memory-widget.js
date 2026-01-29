/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import GTop from 'gi://GTop';

import {Widget} from '../widget-system/Widget.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Memory widget implementation.
 * Monitors RAM usage with program, buffer, and cache metrics.
 */
export default class MemoryWidget extends Widget {
    static get metadata() {
        return {
            id: 'memory',
            elt_short: 'mem',
            name: _('Memory'),
            description: _('Monitor RAM usage'),
            metrics: [
                {key: 'program', label: _('Program'), color: '#0000ff', unit: 'MiB'},
                {key: 'buffer', label: _('Buffer'), color: '#00ff00', unit: 'MiB'},
                {key: 'cache', label: _('Cache'), color: '#ff0000', unit: 'MiB'}
            ]
        };
    }

    constructor(extension, config, renderer, scheduler) {
        super(extension, config, renderer, scheduler);

        this.gtop = null;
        this.mem = [0, 0, 0];
        this.total = 0;
        this.useGiB = false;
        this._unitConversion = 1024 * 1024;
        this._decimals = 100;
    }

    /**
     * Initialize the widget.
     * Called once when the widget is created.
     */
    initialize() {
        this.gtop = new GTop.glibtop_mem();

        GTop.glibtop_get_mem(this.gtop);
        this.total = Math.round(this.gtop.total / 1024 / 1024);

        const threshold = 4 * 1024; // In MiB

        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;

            // Update metric units
            for (const metric of this.metadata.metrics) {
                metric.unit = 'GiB';
            }
        }

        // Store total for normalized calculations
        this._totalGiB = this.useGiB ? this.total / this._decimals : this.total;
    }

    /**
     * Collect current memory data.
     * Called periodically by the scheduler.
     *
     * @returns {Object} Memory usage data
     */
    collect() {
        GTop.glibtop_get_mem(this.gtop);

        // Get raw values in bytes and convert to MiB/GiB
        const programRaw = this.gtop.user;
        const bufferRaw = this.gtop.buffer;
        const cacheRaw = this.gtop.cached;

        // Convert to display units
        let buffer, cache, program, total;

        if (this.useGiB) {
            program = Math.round(programRaw / this._unitConversion) / this._decimals;
            buffer = Math.round(bufferRaw / this._unitConversion) / this._decimals;
            cache = Math.round(cacheRaw / this._unitConversion) / this._decimals;
            total = Math.round(this.gtop.total / this._unitConversion) / this._decimals;
        } else {
            program = Math.round(programRaw / this._unitConversion);
            buffer = Math.round(bufferRaw / this._unitConversion);
            cache = Math.round(cacheRaw / this._unitConversion);
            total = Math.round(this.gtop.total / this._unitConversion);
        }

        this.mem = [program, buffer, cache];
        this.total = total;

        // Calculate normalized values for graphing (0.0 - 1.0)
        const totalBytes = this.gtop.total;
        const normalized = {
            program: programRaw / totalBytes,
            buffer: bufferRaw / totalBytes,
            cache: cacheRaw / totalBytes
        };

        return {
            program,
            buffer,
            cache,
            _normalized: normalized,
            _total: total
        };
    }

    /**
     * Clean up resources.
     */
    destroy() {
        // GTop objects don't need explicit cleanup
        this.gtop = null;
    }
}
