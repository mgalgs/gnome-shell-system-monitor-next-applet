/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import St from 'gi://St';

import {sm_log} from '../utils.js';

/**
 * WidgetRenderer handles UI generation and updates for widgets.
 * Creates status bar labels, menu items, graphs, and tooltips based on metadata.
 */
export class WidgetRenderer {
    constructor(extension, widget) {
        this.extension = extension;
        this.widget = widget;
        this.metadata = widget.metadata;
        this.config = widget.config;

        this.text_items = [];
        this.menu_items = [];
        this.tip_labels = [];
        this.tip_vals = [];
        this.tip_unit_labels = [];
        this.vals = []; // Normalized values for graphing

        // Get color names from metadata
        this.color_name = this.metadata.metrics.map(m => m.key);
        this.colors = [];

        // Initialize colors
        this._initColors();
    }

    /**
     * Initialize colors from settings.
     */
    _initColors() {
        const Schema = this.extension._Schema;
        const {color_from_string} = this._importExtension();

        for (const metric of this.metadata.metrics) {
            const colorKey = `${this.widget.id}-${metric.key}-color`;
            const colorString = Schema.get_string(colorKey);
            const color = color_from_string(colorString);
            this.colors.push(color);

            // Connect to color changes
            Schema.connect(`changed::${colorKey}`, () => {
                const newColor = color_from_string(Schema.get_string(colorKey));
                const idx = this.metadata.metrics.findIndex(m => m.key === metric.key);
                if (idx >= 0) {
                    this.colors[idx] = newColor;
                }
                if (this.chart) {
                    this.chart.actor.queue_repaint();
                }
            });
        }
    }

    /**
     * Import utility functions from extension.js scope.
     */
    _importExtension() {
        return {
            color_from_string: (str) => {
                if (Cogl.Color.from_string) {
                    let [ok, color] = Cogl.Color.from_string(str);
                    if (!ok) {
                        color = new Cogl.Color();
                        Cogl.Color.init_from_4ub(color, 255, 0, 0, 255);
                    }
                    return color;
                }
                return Clutter.Color.from_string(str)[1];
            }
        };
    }

    /**
     * Create text items for the panel.
     *
     * @returns {St.Label[]} Array of labels for the panel
     */
    create_text_items() {
        const Style = this.extension._Style;

        // Default: show percentage value and '%' symbol
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER
            }),
            new St.Label({
                text: '%',
                style_class: Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER
            })
        ];
    }

    /**
     * Create menu items for the dropdown.
     *
     * @returns {St.Label[]} Array of labels for the menu
     */
    create_menu_items() {
        const Style = this.extension._Style;
        const unit = this._getUnit();

        // Default menu layout:
        // [value] [%] [space] [absolute] [unit]
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')
            }),
            new St.Label({
                text: '%',
                style_class: Style.get('sm-label')
            }),
            new St.Label({
                text: '',
                style_class: Style.get('sm-label')
            }),
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')
            }),
            new St.Label({
                text: unit,
                style_class: Style.get('sm-label')
            })
        ];
    }

    /**
     * Get the unit string for display (MiB/GiB).
     */
    _getUnit() {
        // Check if widget has a useGiB property (set during initialization)
        if (this.widget.useGiB !== null) {
            return this.widget.useGiB ? 'GiB' : 'MiB';
        }
        return 'MiB';
    }

    /**
     * Create tooltip formatting.
     *
     * @param {string|Array} unit - Unit string or array for each metric
     */
    tip_format(unit) {
        const {TipItem} = this._importTipMenu();

        if (typeof unit === 'undefined') {
            unit = '%';
        }
        if (typeof unit === 'string') {
            const allUnit = unit;
            unit = [];
            for (let i = 0; i < this.color_name.length; i++) {
                unit.push(allUnit);
            }
        }

        for (let i = 0; i < this.color_name.length; i++) {
            const tipline = new TipItem();
            this.widget.tipmenu.addMenuItem(tipline);

            // Find the metric label
            const metric = this.metadata.metrics.find(m => m.key === this.color_name[i]);
            const label = metric ? metric.label : this.color_name[i];

            tipline.actor.add_child(new St.Label({text: label}));

            this.tip_labels[i] = new St.Label({text: ''});
            tipline.actor.add_child(this.tip_labels[i]);

            this.tip_unit_labels[i] = new St.Label({text: unit[i]});
            tipline.actor.add_child(this.tip_unit_labels[i]);

            this.tip_vals[i] = 0;
        }
    }

    /**
     * Import TipMenu classes from extension.js.
     */
    _importTipMenu() {
        // These classes are defined in extension.js
        // We access them through the extension's internal scope
        // For now, return a placeholder - the actual implementation
        // will be handled by LegacyBridge which has access to the full scope
        return {
            TipItem: this.extension.__sm?.TipItem || Object,
            TipMenu: this.extension.__sm?.TipMenu || Object
        };
    }

    /**
     * Apply collected data to the UI.
     *
     * @param {Object} data - Data returned from widget.collect()
     */
    apply(data) {
        if (!data) {
            return;
        }

        // Update normalized values for graph
        if (data._normalized) {
            for (let i = 0; i < this.color_name.length; i++) {
                const key = this.color_name[i];
                this.vals[i] = data._normalized[key] || 0;
            }
        } else {
            // Calculate from raw values if _normalized not provided
            const total = this._calculateTotal(data);
            for (let i = 0; i < this.color_name.length; i++) {
                const key = this.color_name[i];
                const value = data[key] || 0;
                this.vals[i] = total > 0 ? value / total : 0;
            }
        }

        // Update tooltip values (percentages)
        for (let i = 0; i < this.tip_vals.length; i++) {
            this.tip_vals[i] = Math.round(this.vals[i] * 100);
        }

        // Update UI if elements exist
        this._updateTextItems(data);
        this._updateMenuItems(data);
        this._updateTooltip();
    }

    /**
     * Calculate total from data values.
     */
    _calculateTotal(data) {
        let total = 0;
        for (const metric of this.metadata.metrics) {
            total += data[metric.key] || 0;
        }
        return total;
    }

    /**
     * Update text items in the panel.
     */
    _updateTextItems(data) {
        if (this.text_items.length === 0 || !data) {
            return;
        }

        // First metric percentage
        const firstMetric = this.metadata.metrics[0];
        const firstKey = firstMetric.key;
        let percentage = 0;

        if (data._normalized && data._normalized[firstKey] !== null) {
            percentage = Math.round(data._normalized[firstKey] * 100);
        } else {
            const total = this._calculateTotal(data);
            percentage = total > 0 ? Math.round((data[firstKey] || 0) / total * 100) : 0;
        }

        if (this.text_items[0]) {
            this.text_items[0].text = percentage.toString();
        }
    }

    /**
     * Update menu items in the dropdown.
     */
    _updateMenuItems(data) {
        if (this.menu_items.length === 0 || !data) {
            return;
        }

        const Style = this.extension._Style;
        const Locale = this.extension._Locale;
        const firstMetric = this.metadata.metrics[0];
        const firstKey = firstMetric.key;

        // Calculate percentage
        let percentage = 0;
        if (data._normalized && data._normalized[firstKey] !== null) {
            percentage = Math.round(data._normalized[firstKey] * 100);
        } else {
            const total = this._calculateTotal(data);
            percentage = total > 0 ? Math.round((data[firstKey] || 0) / total * 100) : 0;
        }

        // Calculate used value (sum of all metrics)
        let used = 0;
        for (const metric of this.metadata.metrics) {
            used += data[metric.key] || 0;
        }

        // Total from data or widget
        const total = data._total || this.widget.total || used;

        // Update menu items
        if (this.menu_items[0]) {
            this.menu_items[0].text = percentage.toLocaleString(Locale);
        }

        // Update absolute value display (menu_items[3])
        if (this.menu_items[3]) {
            const usedStr = this._formatValue(used);
            const totalStr = this._formatValue(total);

            if (Style.get('') !== '-compact') {
                this.menu_items[3].text = `${usedStr} / ${totalStr}`;
            } else {
                this.menu_items[3].text = `${usedStr}/${totalStr}`;
            }
        }
    }

    /**
     * Format a numeric value for display.
     */
    _formatValue(value) {
        if (this.widget.useGiB) {
            if (value < 1) {
                return value.toLocaleString(this.extension._Locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
            return value.toLocaleString(this.extension._Locale, {
                minimumSignificantDigits: 3,
                maximumSignificantDigits: 3
            });
        }

        return value.toLocaleString(this.extension._Locale);
    }

    /**
     * Update tooltip labels.
     */
    _updateTooltip() {
        for (let i = 0; i < this.tip_vals.length; i++) {
            if (this.tip_labels[i]) {
                this.tip_labels[i].text = this.tip_vals[i].toString();
            }
        }
    }

    /**
     * Set text items array.
     */
    setTextItems(items) {
        this.text_items = items;
    }

    /**
     * Set menu items array.
     */
    setMenuItems(items) {
        this.menu_items = items;
    }
}
