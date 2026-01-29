/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Cogl from 'gi://Cogl';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {sm_log} from '../utils.js';

// Import TipItem and TipMenu inline to avoid circular dependencies
const TipItem = GObject.registerClass(
    {
        GTypeName: 'WidgetTipItem'
    },
    class extends PopupMenu.PopupBaseMenuItem {
        _init() {
            super._init();
            this.actor.remove_style_class_name('popup-menu-item');
            this.actor.add_style_class_name('sm-tooltip-item');
        }
    }
);

const TipMenu = class extends PopupMenu.PopupMenuBase {
    constructor(sourceActor) {
        super(sourceActor, 'sm-tooltip-box');
        this.actor = new Clutter.Actor();
        this.actor.add_child(this.box);
    }

    _shift() {
        const node = this.sourceActor.get_theme_node();
        const contentbox = node.get_content_box(this.sourceActor.get_allocation_box());

        let sourceTopLeftX = 0;
        let sourceTopLeftY = 0;
        if (typeof this.sourceActor.get_transformed_extents === 'function') {
            const extents = this.sourceActor.get_transformed_extents();
            const sourceTopLeft = extents.get_top_left();
            sourceTopLeftY = sourceTopLeft.y;
            sourceTopLeftX = sourceTopLeft.x;
        }

        const monitor = Main.layoutManager.findMonitorForActor(this.sourceActor);
        const [x, y] = [sourceTopLeftX + contentbox.x1, sourceTopLeftY + contentbox.y1];
        const [xm, ym] = [sourceTopLeftX + contentbox.x2, sourceTopLeftY + contentbox.y2];
        const [width, height] = this.actor.get_size();

        let tipx = (sourceTopLeftX + (contentbox.x1 + contentbox.x2) / 2) - width / 2;
        tipx = Math.max(tipx, monitor.x);
        tipx = Math.min(tipx, monitor.x + monitor.width - width);
        tipx = Math.floor(tipx);

        let tipy = Math.floor(ym);
        if (sourceTopLeftY / monitor.height > 0.3) {
            tipy = sourceTopLeftY - height;
        }

        this.actor.set_position(tipx, tipy);
    }

    open(animate) {
        if (this.isOpen) {
            return;
        }
        this.isOpen = true;
        this.actor.show();
        this._shift();
        this.actor.raise_top();
        this.emit('open-state-changed', true);
    }

    close(animate) {
        this.isOpen = false;
        this.actor.hide();
        this.emit('open-state-changed', false);
    }
};

const RotateBinLayout = GObject.registerClass(
    {
        GTypeName: 'WidgetRotateBinLayout'
    },
    class extends Clutter.BinLayout {
        vfunc_get_preferred_width(container, for_height) {
            return super.vfunc_get_preferred_height(container, for_height);
        }

        vfunc_get_preferred_height(container, for_width) {
            return super.vfunc_get_preferred_width(container, for_width);
        }

        vfunc_allocate(container, box) {
            const box2 = new Clutter.ActorBox({
                x1: box.x1,
                x2: box.x1 + box.y2 - box.y1,
                y1: box.y2,
                y2: box.y2 + box.x2 - box.x1,
            });
            return super.vfunc_allocate(container, box2);
        }
    }
);

/**
 * LegacyBridge wraps a widget to expose the legacy ElementBase interface.
 * This allows widgets to integrate with existing extension.js code.
 */
export class LegacyBridge {
    constructor(widget, extension) {
        this.widget = widget;
        this.extension = extension;
        this.metadata = widget.metadata;
        this.config = widget.config;

        // Legacy interface properties
        this.elt = widget.id;
        this.elt_short = this.metadata.elt_short || this.elt.substring(0, 3);
        this.item_name = this.metadata.name;
        this.color_name = this.metadata.metrics.map(m => m.key);
        this.menu_visible = true;
        this.timeout = null;

        // Data arrays (legacy interface)
        this.vals = [];
        this.tip_labels = [];
        this.tip_vals = [];
        this.tip_unit_labels = [];
        this.text_items = [];
        this.menu_items = [];

        // Graph scaling
        this.graph_scale_max_including_cooldown = 0;
        this.graph_scale_cooldown_timer_id = null;
        this.graph_scale_cooldown_delay_minutes = 0;

        // Tooltip timers
        this.in_to = 0;
        this.out_to = 0;

        // Create main actor (replaces TipBox inheritance)
        this._initActor();

        // Initialize UI
        this._initUI();

        // Connect settings
        this._connectSettings();

        // Initialize tooltip
        this._initTooltip();

        // Initialize widget
        widget.initialize();
    }

    /**
     * Initialize the main actor with tooltip support.
     */
    _initActor() {
        this.actor = new St.BoxLayout({reactive: true});
        this.actor._delegate = this;

        // Set up tooltip
        this.set_tip(new TipMenu(this.actor));

        // Connect events
        this.actor.connect('enter-event', this.on_enter.bind(this));
        this.actor.connect('leave-event', this.on_leave.bind(this));
    }

    /**
     * Set up tooltip menu.
     */
    set_tip(tipmenu) {
        if (this.tipmenu) {
            this.tipmenu.destroy();
        }
        this.tipmenu = tipmenu;
        if (this.tipmenu) {
            Main.uiGroup.add_child(this.tipmenu.actor);
            this.hide_tip();
        }
    }

    /**
     * Show tooltip.
     */
    show_tip() {
        if (this.tipmenu) {
            this.tipmenu.open();
        }
        return GLib.SOURCE_REMOVE;
    }

    /**
     * Hide tooltip.
     */
    hide_tip() {
        if (!this.tipmenu) {
            return;
        }
        this.tipmenu.close();
        this.stop_out_timer();
        this.stop_in_timer();
    }

    /**
     * Handle enter event.
     */
    on_enter() {
        const showTooltip = this.extension._Schema.get_boolean('show-tooltip');
        if (!showTooltip) {
            return;
        }
        this.stop_out_timer();
        this.start_in_timer();
    }

    /**
     * Handle leave event.
     */
    on_leave() {
        this.stop_in_timer();
        this.start_out_timer();
    }

    /**
     * Start tooltip show timer.
     */
    start_in_timer() {
        if (!this.in_to) {
            this.in_to = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.extension._Schema.get_int('tooltip-delay-ms'),
                this.show_tip.bind(this)
            );
        }
    }

    /**
     * Stop tooltip show timer.
     */
    stop_in_timer() {
        if (this.in_to) {
            GLib.Source.remove(this.in_to);
            this.in_to = 0;
        }
    }

    /**
     * Start tooltip hide timer.
     */
    start_out_timer() {
        if (!this.out_to) {
            this.out_to = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.extension._Schema.get_int('tooltip-delay-ms'),
                this.hide_tip.bind(this)
            );
        }
    }

    /**
     * Stop tooltip hide timer.
     */
    stop_out_timer() {
        if (this.out_to) {
            GLib.Source.remove(this.out_to);
            this.out_to = 0;
        }
    }

    /**
     * Initialize the UI components.
     */
    _initUI() {
        const Schema = this.extension._Schema;
        const Style = this.extension._Style;
        const IconSize = this.extension._IconSize;

        // Initialize colors
        this.colors = [];
        for (const metric of this.metadata.metrics) {
            const colorKey = `${this.elt}-${metric.key}-color`;
            const colorString = Schema.get_string(colorKey);
            const color = this._colorFromString(colorString);
            this.colors.push(color);
        }

        // Create chart
        let elementWidth = Schema.get_int(`${this.elt}-graph-width`);
        if (Style.get('') === '-compact') {
            elementWidth = Math.round(elementWidth / 1.5);
        }

        // We need to import Chart from extension context
        this.chart = this._createChart(elementWidth, IconSize);

        // Set visibility
        this.actor.visible = Schema.get_boolean(`${this.elt}-display`);

        // Create label
        this.label = new St.Label({
            text: this.elt_short,
            style_class: Style.get('sm-status-label')
        });
        this._updateLabelVisibility();

        // Label bin with rotation support
        this.label_bin = new St.Bin({child: this.label});
        const defaultLayout = this.label_bin.layout_manager;

        const updateRotation = () => {
            if (Schema.get_boolean('rotate-labels')) {
                this.label.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, -90);
                this.label.add_style_class_name('rotated');
                this.label_bin.layout_manager = new RotateBinLayout();
                this.label_bin.y_align = Clutter.ActorAlign.CENTER;
            } else {
                this.label.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, 0);
                this.label.remove_style_class_name('rotated');
                this.label_bin.layout_manager = defaultLayout;
                this.label_bin.y_align = Clutter.ActorAlign.START;
            }
        };

        updateRotation();
        Schema.connect('changed::rotate-labels', updateRotation);

        // Add to actor
        this.actor.add_child(this.label_bin);

        // Text box
        this.text_box = new St.BoxLayout();
        this.actor.add_child(this.text_box);

        // Create text items
        this.text_items = this.widget.renderer.create_text_items();
        for (const item of this.text_items) {
            this.text_box.add_child(item);
        }

        // Add chart
        this.actor.add_child(this.chart.actor);

        // Update style
        this._updateStyle();

        // Create menu items
        this.menu_items = this.widget.renderer.create_menu_items();

        // Start cooldown timer
        this.restart_cooldown_timer();
    }

    /**
     * Create chart - to be overridden with actual Chart class from extension.
     */
    _createChart(width, height) {
        // This will be replaced by the actual Chart from extension.js
        // For now, create a stub that will be properly set up during integration
        const actor = new St.DrawingArea({style_class: 'sm-chart', reactive: false});
        actor.set_width(width);
        actor.set_height(height);

        return {
            actor: actor,
            update: () => {},
            resize: (w) => {
                actor.set_width(w);
            }
        };
    }

    /**
     * Set the actual chart instance.
     */
    setChart(chart) {
        // Replace stub chart with real one
        const oldActor = this.chart.actor;
        const parent = oldActor.get_parent();

        if (parent) {
            parent.remove_child(oldActor);
            parent.add_child(chart.actor);
        }

        this.chart = chart;
    }

    /**
     * Convert color string to Clutter/Cogl color.
     */
    _colorFromString(colorString) {
        if (Cogl.Color.from_string) {
            let [ok, color] = Cogl.Color.from_string(colorString);
            if (!ok) {
                color = new Cogl.Color();
                Cogl.Color.init_from_4ub(color, 255, 0, 0, 255);
            }
            return color;
        }
        return Clutter.Color.from_string(colorString)[1];
    }

    /**
     * Connect to settings changes.
     */
    _connectSettings() {
        const Schema = this.extension._Schema;

        // Display setting
        Schema.connect(`changed::${this.elt}-display`, (schema, key) => {
            this.actor.visible = Schema.get_boolean(key);
        });

        // Refresh time
        const refreshInterval = this._limitInterval(Schema.get_int(`${this.elt}-refresh-time`));
        this.restart_update_timer(refreshInterval);

        Schema.connect(`changed::${this.elt}-refresh-time`, (schema, key) => {
            this.restart_update_timer(this._limitInterval(Schema.get_int(key)));
        });

        // Graph width
        Schema.connect(`changed::${this.elt}-graph-width`, this.resize.bind(this));

        // Show text
        this._updateLabelVisibility();
        Schema.connect(`changed::${this.elt}-show-text`, this._updateLabelVisibility.bind(this));

        // Show menu
        this.menu_visible = Schema.get_boolean(`${this.elt}-show-menu`);
        Schema.connect(`changed::${this.elt}-show-menu`, () => {
            this.menu_visible = Schema.get_boolean(`${this.elt}-show-menu`);
            this._onMenuVisibilityChanged();
        });

        // Style
        this._updateStyle();
        Schema.connect(`changed::${this.elt}-style`, this._updateStyle.bind(this));

        // Color changes
        for (const metric of this.metadata.metrics) {
            const colorKey = `${this.elt}-${metric.key}-color`;
            Schema.connect(`changed::${colorKey}`, () => {
                const idx = this.metadata.metrics.findIndex(m => m.key === metric.key);
                if (idx >= 0) {
                    this.colors[idx] = this._colorFromString(Schema.get_string(colorKey));
                    this.chart.actor.queue_repaint();
                }
            });
        }

        // Background change
        Schema.connect('changed::background', () => {
            this.chart.actor.queue_repaint();
        });

        // Cooldown timer
        Schema.connect('changed::graph-cooldown-delay-m', () => {
            this.restart_cooldown_timer();
        });
    }

    /**
     * Initialize tooltip.
     */
    _initTooltip() {
        // Initialize tip_vals
        for (let i = 0; i < this.color_name.length; i++) {
            this.tip_vals[i] = 0;
        }

        // Set up tooltip format
        this.tip_format('%');
    }

    /**
     * Limit interval to minimum.
     */
    _limitInterval(t) {
        return (t > 0) ? t : 1000;
    }

    /**
     * Update label visibility.
     */
    _updateLabelVisibility() {
        const Schema = this.extension._Schema;
        this.label.visible = Schema.get_boolean(`${this.elt}-show-text`);
    }

    /**
     * Update style (digit/graph/both).
     */
    _updateStyle() {
        const Schema = this.extension._Schema;
        const style = Schema.get_string(`${this.elt}-style`);

        this.text_box.visible = style === 'digit' || style === 'both';
        this.chart.actor.visible = style === 'graph' || style === 'both';
    }

    /**
     * Called when menu visibility changes.
     */
    _onMenuVisibilityChanged() {
        // This will trigger a menu rebuild via the extension
    }

    /**
     * Restart cooldown timer.
     */
    restart_cooldown_timer(max = 0) {
        if (this.graph_scale_cooldown_timer_id) {
            GLib.Source.remove(this.graph_scale_cooldown_timer_id);
        }

        this.graph_scale_max_including_cooldown = max;
        this.graph_scale_cooldown_delay_minutes = this.extension._Schema.get_int('graph-cooldown-delay-m');

        if (this.graph_scale_cooldown_delay_minutes !== 0) {
            this.graph_scale_cooldown_timer_id = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                this.graph_scale_cooldown_delay_minutes * 60,
                () => {
                    this.restart_cooldown_timer();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
    }

    /**
     * Restart update timer.
     */
    restart_update_timer(interval) {
        if (this.timeout) {
            GLib.Source.remove(this.timeout);
        }

        this._lastInterval = interval;
        this.timeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            interval,
            this.update.bind(this)
        );
    }

    /**
     * Set up tooltip format.
     */
    tip_format(unit) {
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
            this.tipmenu.addMenuItem(tipline);

            const metric = this.metadata.metrics.find(m => m.key === this.color_name[i]);
            const label = metric ? metric.label : this.color_name[i];

            tipline.actor.add_child(new St.Label({text: label}));

            this.tip_labels[i] = new St.Label({text: ''});
            tipline.actor.add_child(this.tip_labels[i]);

            this.tip_unit_labels[i] = new St.Label({text: unit[i]});
            tipline.actor.add_child(this.tip_unit_labels[i]);
        }
    }

    /**
     * Main update method called by timer.
     */
    update() {
        if (!this.menu_visible && !this.actor.visible) {
            return GLib.SOURCE_CONTINUE;
        }

        try {
            // Call widget's collect
            const data = this.widget.collect();

            // Process data
            if (data) {
                this._processData(data);
            }

            // Update chart
            this.chart.update();

            // Update tooltips
            for (let i = 0; i < this.tip_vals.length; i++) {
                if (this.tip_labels[i]) {
                    this.tip_labels[i].text = this.tip_vals[i].toString();
                }
            }
        } catch (e) {
            sm_log(`Error updating ${this.elt}: ${e.message}`, 'error');
        }

        return GLib.SOURCE_CONTINUE;
    }

    /**
     * Process collected data.
     */
    _processData(data) {
        // Update vals for graph
        if (data._normalized) {
            for (let i = 0; i < this.color_name.length; i++) {
                const key = this.color_name[i];
                this.vals[i] = data._normalized[key] || 0;
            }
        }

        // Update tip_vals (percentages)
        for (let i = 0; i < this.tip_vals.length; i++) {
            this.tip_vals[i] = Math.round(this.vals[i] * 100);
        }

        // Apply through renderer
        this.widget.renderer.apply(data);

        // Update text items
        this._updateTextItems(data);

        // Update menu items
        this._updateMenuItems(data);
    }

    /**
     * Update text items.
     */
    _updateTextItems(data) {
        if (this.text_items.length === 0) {
            return;
        }

        const firstMetric = this.metadata.metrics[0];
        const firstKey = firstMetric.key;

        let percentage = 0;
        if (data._normalized && firstKey in data._normalized) {
            percentage = Math.round(data._normalized[firstKey] * 100);
        }

        if (this.text_items[0]) {
            this.text_items[0].text = percentage.toString();
        }
    }

    /**
     * Update menu items.
     */
    _updateMenuItems(data) {
        if (this.menu_items.length === 0) {
            return;
        }

        const Style = this.extension._Style;
        const Locale = this.extension._Locale;
        const firstMetric = this.metadata.metrics[0];
        const firstKey = firstMetric.key;

        // Calculate percentage
        let percentage = 0;
        if (data._normalized && firstKey in data._normalized) {
            percentage = Math.round(data._normalized[firstKey] * 100);
        }

        // Calculate used
        let used = 0;
        for (const metric of this.metadata.metrics) {
            used += data[metric.key] || 0;
        }

        const total = data._total || this.widget.total || used;

        // Update menu items
        if (this.menu_items[0]) {
            this.menu_items[0].text = percentage.toLocaleString(Locale);
        }

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
     * Format value for display.
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
     * Resize chart.
     */
    resize(schema, key) {
        const Schema = this.extension._Schema;
        const Style = this.extension._Style;

        let width = Schema.get_int(key);
        if (Style.get('') === '-compact') {
            width = Math.round(width / 1.5);
        }

        this.chart.resize(width);
    }

    /**
     * Create text items (legacy interface).
     */
    create_text_items() {
        return this.text_items;
    }

    /**
     * Create menu items (legacy interface).
     */
    create_menu_items() {
        return this.menu_items;
    }

    /**
     * Refresh data (legacy interface, called by update).
     */
    refresh() {
        // Data collection happens in update() via widget
    }

    /**
     * Apply data (legacy interface, called by update).
     */
    _apply() {
        // Data application happens in update() via renderer
    }

    /**
     * Destroy the bridge and clean up.
     */
    destroy() {
        // Stop timer
        if (this.timeout) {
            GLib.Source.remove(this.timeout);
            this.timeout = null;
        }

        // Stop cooldown timer
        if (this.graph_scale_cooldown_timer_id) {
            GLib.Source.remove(this.graph_scale_cooldown_timer_id);
            this.graph_scale_cooldown_timer_id = null;
        }

        // Stop tooltip timers
        this.stop_in_timer();
        this.stop_out_timer();

        // Destroy widget
        if (this.widget) {
            this.widget.destroy();
        }

        // Disconnect settings
        if (this.config) {
            this.config.disconnectAll();
        }

        // Destroy tooltip menu
        if (this.tipmenu) {
            this.tipmenu.destroy();
        }

        // Destroy actor
        if (this.actor) {
            this.actor.destroy();
        }
    }

    /**
     * Static factory method to wrap a widget.
     *
     * @param {Widget} widget - Widget instance
     * @param {Object} extension - Extension instance
     * @returns {LegacyBridge} Bridged widget
     */
    static wrap(widget, extension) {
        return new LegacyBridge(widget, extension);
    }
}
