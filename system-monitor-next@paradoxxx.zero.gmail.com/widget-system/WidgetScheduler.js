/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import GLib from 'gi://GLib';
import {sm_log} from '../utils.js';

/**
 * WidgetScheduler manages update timers for widgets.
 * Handles periodic collect() calls, error handling, and interval changes.
 */
export class WidgetScheduler {
    constructor(widget) {
        this.widget = widget;
        this.config = widget.config;
        this.timeout = null;
        this._interval = null;
        this._running = false;
        this._updateInProgress = false;
    }

    /**
     * Start the scheduler.
     *
     * @param {number} interval - Update interval in milliseconds
     */
    start(interval) {
        if (this._running) {
            this.stop();
        }

        this._interval = this._limitInterval(interval);
        this._running = true;

        // Schedule first update
        this._scheduleUpdate();

        sm_log(`Started scheduler for ${this.widget.id} with interval ${this._interval}ms`);
    }

    /**
     * Stop the scheduler.
     */
    stop() {
        this._running = false;

        if (this.timeout) {
            GLib.Source.remove(this.timeout);
            this.timeout = null;
        }
    }

    /**
     * Change the update interval.
     *
     * @param {number} interval - New interval in milliseconds
     */
    setInterval(interval) {
        this._interval = this._limitInterval(interval);

        // Restart if running
        if (this._running) {
            this.stop();
            this._running = true;
            this._scheduleUpdate();
        }
    }

    /**
     * Get current interval.
     *
     * @returns {number} Current interval in milliseconds
     */
    getInterval() {
        return this._interval;
    }

    /**
     * Check if scheduler is running.
     *
     * @returns {boolean} True if running
     */
    isRunning() {
        return this._running;
    }

    /**
     * Limit interval to a minimum value.
     */
    _limitInterval(t) {
        return (t > 0) ? t : 1000;
    }

    /**
     * Schedule the next update.
     */
    _scheduleUpdate() {
        if (!this._running) {
            return;
        }

        this.timeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            this._interval,
            this._onUpdate.bind(this)
        );
    }

    /**
     * Handle update tick.
     */
    async _onUpdate() {
        if (!this._running) {
            return GLib.SOURCE_REMOVE;
        }

        // Skip if previous update still in progress
        if (this._updateInProgress) {
            return GLib.SOURCE_CONTINUE;
        }

        this._updateInProgress = true;

        try {
            await this._executeUpdate();
        } catch (e) {
            sm_log(`Error in widget ${this.widget.id} update: ${e.message}`, 'error');
        } finally {
            this._updateInProgress = false;
        }

        return GLib.SOURCE_CONTINUE;
    }

    /**
     * Execute the update cycle.
     */
    async _executeUpdate() {
        // Check visibility
        const menuVisible = this.config.getBoolean('show-menu');
        const displayVisible = this.config.getBoolean('display');

        if (!menuVisible && !displayVisible) {
            return;
        }

        // Call widget's collect method
        let data;
        try {
            data = await this._callCollect();
        } catch (e) {
            sm_log(`Widget ${this.widget.id} collect() failed: ${e.message}`, 'error');
            return;
        }

        // Apply data through renderer
        if (data && this.widget.renderer) {
            this.widget.renderer.apply(data);
        }

        // Update chart if available (handled by LegacyBridge)
        if (this.widget._updateChart) {
            this.widget._updateChart();
        }

        // Update tooltip values
        if (this.widget._updateTooltip) {
            this.widget._updateTooltip();
        }
    }

    /**
     * Call widget's collect method (handles sync and async).
     */
    async _callCollect() {
        const result = this.widget.collect();

        // Handle async collect()
        if (result && typeof result.then === 'function') {
            return await result;
        }

        return result;
    }

    /**
     * Destroy the scheduler and clean up.
     */
    destroy() {
        this.stop();
    }
}
