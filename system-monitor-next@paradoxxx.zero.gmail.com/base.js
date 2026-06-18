/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// system-monitor: Gnome shell extension displaying system informations in gnome shell status bar, such as memory usage, cpu usage, network rates…
// Copyright (C) 2011 Florian Mounier aka paradoxxxzero

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Author: Florian Mounier aka paradoxxxzero

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Cogl from "gi://Cogl";
import Gio from "gi://Gio";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { sm_log } from './utils.js';
import { parse_bytearray } from './common.js';

Clutter.Actor.prototype.raise_top = function raise_top() {
    const parent = this.get_parent();
    if (!parent) {
        return;
    }
    parent.set_child_above_sibling(this, null);
}
Clutter.Actor.prototype.reparent = function reparent(newParent) {
    const parent = this.get_parent();
    if (parent) {
        parent.remove_child(this);
    }
    newParent.add_child(this);
}

export function l_limit(t) {
    return (t > 0) ? t : 1000;
}

export function change_text() {
    this.label.visible = this.config['show-text'];
}

export function change_style() {
    let style = this.config.style;
    this.text_box.visible = style === 'digit' || style === 'both';
    this.chart.actor.visible = style === 'graph' || style === 'both';
}

export function build_menu_info(extension) {
    let elts = extension.__sm.elts;
    let tray_menu = extension.__sm.tray.menu;

    let firstItem = tray_menu._getMenuItems()[0];
    let lastChild = firstItem?.actor.get_last_child();
    if (lastChild) {
        lastChild.destroy_all_children();
        for (let elt in elts) {
            elts[elt].menu_items = elts[elt].create_menu_items();
        }
    } else {
        return;
    }

    let menu_info_box_table = new St.Widget({
        style: 'padding: 10px 0px 10px 0px; spacing-rows: 10px; spacing-columns: 15px;',
        layout_manager: new Clutter.GridLayout({orientation: Clutter.Orientation.VERTICAL})
    });
    let menu_info_box_table_layout = menu_info_box_table.layout_manager;

    // Populate Table
    let row_index = 0;
    for (let elt in elts) {
        if (!elts[elt].menu_visible) {
            continue;
        }

        // Add item name to table
        menu_info_box_table_layout.attach(
            new St.Label({
                text: elts[elt].item_name,
                style_class: extension._Style.get('sm-title'),
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER
            }), 0, row_index, 1, 1);

        // Add item data to table
        let col_index = 1;
        for (let item in elts[elt].menu_items) {
            menu_info_box_table_layout.attach(
                elts[elt].menu_items[item], col_index, row_index, 1, 1);

            col_index++;
        }

        row_index++;
    }
    tray_menu._getMenuItems()[0].actor.get_last_child().add_child(menu_info_box_table);
}

export function change_menu() {
    this.menu_visible = this.config['show-menu'];
    build_menu_info(this.extension);
}

function cogl_color_from_string(colorString) {
    let [ok, color] = Cogl.Color.from_string(colorString);
    if (!ok) {
        sm_log(`Failed to parse color string (${colorString}). Falling back to red.`);
        color = new Cogl.Color();
        Cogl.Color.init_from_4ub(color, 255, 0, 0, 255);
    }
    return color;
}

function clutter_color_from_string(colorString) {
    return Clutter.Color.from_string(colorString)[1];
}

export function color_from_string(colorString) {
    if (Cogl.Color.from_string)
        return cogl_color_from_string(colorString);
    return clutter_color_from_string(colorString);
}

// Gnome 45 Clutter.cairo_set_source_color compatibility
export function sm_cairo_set_source_color(cr, bg_color) {
    if (Clutter.cairo_set_source_color)
        Clutter.cairo_set_source_color(cr, bg_color);
    else
        cr.setSourceColor(bg_color);
}

export function try_read_int_file(filename, callback) {
    if (filename && GLib.file_test(filename, GLib.FileTest.EXISTS)) {
        let file = Gio.file_new_for_path(filename);
        file.load_contents_async(null, (source, result) => {
            let as_r = source.load_contents_finish(result);
            callback(parseInt(parse_bytearray(as_r[1])));
        });
        return true;
    }
    return false;
}

export const smStyleManager = class SystemMonitor_smStyleManager {
    constructor(extension) {
        this.extension = extension;
        this._suffix = '';
        this._iconsize = 1;
        this._diskunits = _('MiB/s');
        this._netunits_kbytes = _('KiB/s');
        this._netunits_mbytes = _('MiB/s');
        this._netunits_gbytes = _('GiB/s');
        this._netunits_kbits = _('kbit/s');
        this._netunits_mbits = _('Mbit/s');
        this._netunits_gbits = _('Gbit/s');
        this._pie_size = 300;
        this._pie_fontsize = 14;
        this._bar_width = 300;

        this._bar_thickness = 15;
        this._bar_fontsize = 14;
        this._compact = this.extension._Schema.get_boolean('compact-display');

        if (this._compact) {
            this._suffix = '-compact';
            this._iconsize = 3 / 5;
            this._diskunits = _('MB');
            this._netunits_kbytes = _('kB');
            this._netunits_mbytes = _('MB');
            this._netunits_gbytes = _('GB');
            this._netunits_kbits = 'kb';
            this._netunits_mbits = 'Mb';
            this._netunits_gbits = 'Gb';
            this._pie_size *= 4 / 5;
            this._pie_fontsize = 12;
            this._bar_width *= 3 / 5;
            this._bar_thickness = 12;
            this._bar_fontsize = 12;
        }
    }
    get(style) {
        return style + this._suffix;
    }
    iconsize() {
        return this._iconsize;
    }
    diskunits() {
        return this._diskunits;
    }
    netunits_kbytes() {
        return this._netunits_kbytes;
    }
    netunits_mbytes() {
        return this._netunits_mbytes;
    }
    netunits_gbytes() {
        return this._netunits_gbytes;
    }
    netunits_kbits() {
        return this._netunits_kbits;
    }
    netunits_mbits() {
        return this._netunits_mbits;
    }
    netunits_gbits() {
        return this._netunits_gbits;
    }
    pie_size() {
        return this._pie_size;
    }
    pie_fontsize() {
        return this._pie_fontsize;
    }
    bar_width() {
        return this._bar_width;
    }
    bar_thickness() {
        return this._bar_thickness;
    }
    bar_fontsize() {
        return this._bar_fontsize;
    }
}

export const Chart = class SystemMonitor_Chart {
    constructor(extension, width, height, parent) {
        this.extension = extension;
        this.actor = new St.DrawingArea({style_class: extension._Style.get('sm-chart'), reactive: false});
        this.parentC = parent;
        this.width = width;
        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.scale_factor = themeContext.scale_factor;
        this.actor.set_width(this.width * this.scale_factor);
        this.actor.set_height(height);
        this.data = [];
        for (let i = 0; i < this.parentC.colors.length; i++) {
            this.data[i] = [];
        }
        themeContext.connectObject('notify::scale-factor', this.rescale.bind(this), this);
        this.actor.connect('repaint', this._draw.bind(this));
    }
    update() {
        let data_a = this.parentC.vals;
        if (data_a.length !== this.parentC.colors.length) {
            return;
        }
        let accdata = [];
        for (let l = 0; l < data_a.length; l++) {
            accdata[l] = (l === 0) ? data_a[0] : accdata[l - 1] + ((data_a[l] > 0) ? data_a[l] : 0);
            this.data[l].push(accdata[l]);
            if (this.data[l].length > this.width) {
                this.data[l].shift();
            }
        }
        if (!this.actor.visible) {
            return;
        }
        this.actor.queue_repaint();
    }
    _draw() {
        if (!this.actor.visible) {
            return;
        }
        let [width, height] = this.actor.get_surface_size();
        let cr = this.actor.get_context();
        let min = 0, max;
        if (this.parentC.min) {
            min = this.parentC.min;
        }
        if (this.parentC.max) {
            max = this.parentC.max;
        } else {
            max = Math.max.apply(this, this.data[this.data.length - 1]);
            max = Math.max(1, Math.pow(2, Math.ceil(Math.log(max) / Math.log(2))));
            if (this.parentC.graph_scale_cooldown_delay_minutes !== 0) {
                if (max > this.parentC.graph_scale_max_including_cooldown) {
                    // Restart the cooldown period with this new max.
                        this.parentC.restart_cooldown_timer(max);
                }
                this.parentC.graph_scale_max_including_cooldown =
                    Math.max(max, this.parentC.graph_scale_max_including_cooldown);
                max = this.parentC.graph_scale_max_including_cooldown;
            }
        }
        const range = max - min, top = 1 + min / range;
        sm_cairo_set_source_color(cr, this.extension._Background);
        cr.rectangle(0, 0, width, height);
        cr.fill();
        for (let i = this.parentC.colors.length - 1; i >= 0; i--) {
            let samples = this.data[i].length - 1;
            if (samples > 0) {
                cr.moveTo(width, height); // bottom right
                let x = width - 0.25 * this.scale_factor;
                cr.lineTo(x, (top - this.data[i][samples] / range) * height);
                x -= 0.5 * this.scale_factor;
                for (let j = samples; j >= 0; j--) {
                    let y = (top - this.data[i][j] / range) * height;
                    cr.lineTo(x, y);
                    x -= 0.5 * this.scale_factor;
                    cr.lineTo(x, y);
                    x -= 0.5 * this.scale_factor;
                }
                x += 0.25 * this.scale_factor;
                cr.lineTo(x, (top - this.data[i][0] / range) * height);
                cr.lineTo(x, height);
                cr.closePath();
                sm_cairo_set_source_color(cr, this.parentC.colors[i]);
                cr.fill();
            }
        }
        cr.$dispose();
    }
    resize(width) {
        if (this.width === width) {
            return;
        }
        this.width = width;
        if (this.width < this.data[0].length) {
            for (let i = 0; i < this.parentC.colors.length; i++) {
                this.data[i] = this.data[i].slice(-this.width);
            }
        }
        this.actor.set_width(this.width * this.scale_factor); // repaints
    }
    rescale(themeContext) {
        this.scale_factor = themeContext.scale_factor;
        this.actor.set_width(this.width * this.scale_factor); // repaints
    }
    destroy() {
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
    }
}

export let TipItem = GObject.registerClass(
    {
        GTypeName: 'TipItem'
    },
    class SystemMonitor_TipItem extends PopupMenu.PopupBaseMenuItem {
        constructor() {
            super();
            this.actor.remove_style_class_name('popup-menu-item');
            this.actor.add_style_class_name('sm-tooltip-item');
        }
    }
);
export const TipMenu = class SystemMonitor_TipMenu extends PopupMenu.PopupMenuBase {
    constructor(sourceActor) {
        // PopupMenu.PopupMenuBase.prototype._init.call(this, sourceActor, 'sm-tooltip-box');
        super(sourceActor, 'sm-tooltip-box');
        this.actor = new Clutter.Actor();
        // this.actor.connect('get-preferred-width',
        //     this._boxGetPreferredWidth).bind(this);
        // this.actor.connect('get-preferred-height',
        //     this._boxGetPreferredHeight.bind(this));
        this.actor.add_child(this.box);
    }
    // _boxGetPreferredWidth (actor, forHeight, alloc) {
    //     // let columnWidths = this.getColumnWidths();
    //     // this.setColumnWidths(columnWidths);
    //
    //     [alloc.min_size, alloc.natural_size] = this.box.get_preferred_width(forHeight);
    // }
    // _boxGetPreferredHeight (actor, forWidth, alloc) {
    //     [alloc.min_size, alloc.natural_size] = this.box.get_preferred_height(forWidth);
    // }
    // _boxAllocate (actor, box, flags) {
    //     this.box.allocate(box, flags);
    // }
    _shift() {
        // Probably old but works
        let node = this.sourceActor.get_theme_node();
        let contentbox = node.get_content_box(this.sourceActor.get_allocation_box());

        let sourceTopLeftX = 0;
        let sourceTopLeftY = 0;
        let extents = this.sourceActor.get_transformed_extents();
        let sourceTopLeft = extents.get_top_left();
        sourceTopLeftY = sourceTopLeft.y;
        sourceTopLeftX = sourceTopLeft.x;
        let monitor = Main.layoutManager.findMonitorForActor(this.sourceActor);
        let [_x, _y] = [sourceTopLeftX + contentbox.x1,
            sourceTopLeftY + contentbox.y1];
        let [cx, _cy] = [sourceTopLeftX + (contentbox.x1 + contentbox.x2) / 2,
            sourceTopLeftY + (contentbox.y1 + contentbox.y2) / 2];
        let [_xm, ym] = [sourceTopLeftX + contentbox.x2,
            sourceTopLeftY + contentbox.y2];
        let [width, height] = this.actor.get_size();
        let tipx = cx - width / 2;
        tipx = Math.max(tipx, monitor.x);
        tipx = Math.min(tipx, monitor.x + monitor.width - width);
        tipx = Math.floor(tipx);
        let tipy = Math.floor(ym);
        // Hacky condition to determine if the status bar is at the top or at the bottom of the screen
        if (sourceTopLeftY / monitor.height > 0.3) {
            tipy = sourceTopLeftY - height; // If it is at the bottom, place the tooltip above instead of below
        }
        this.actor.set_position(tipx, tipy);
    }
    open(_animate) {
        if (this.isOpen) {
            return;
        }

        this.isOpen = true;
        this.actor.show();
        this._shift();
        this.actor.raise_top();
        this.emit('open-state-changed', true);
    }
    close(_animate) {
        this.isOpen = false;
        this.actor.hide();
        this.emit('open-state-changed', false);
    }
}

export const TipBox = class SystemMonitor_TipBox {
    constructor(extension) {
        this.extension = extension;
        this.actor = new St.BoxLayout({reactive: true});
        this.actor._delegate = this;
        this.set_tip(new TipMenu(this.actor));
        this.in_to = 0;
        this.out_to = 0;
        this.actor.connectObject(
            'enter-event', this.on_enter.bind(this),
            'leave-event', this.on_leave.bind(this),
            this
        );
    }
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
    show_tip() {
        this.in_to = 0;
        if (this.tipmenu)
            this.tipmenu.open();
        return GLib.SOURCE_REMOVE;
    }
    hide_tip() {
        if (!this.tipmenu) {
            return;
        }
        this.tipmenu.close();
        this.stop_out_timer();
        this.stop_in_timer();
    }
    on_enter() {
        let show_tooltip = this.extension._Schema.get_boolean('show-tooltip');

        if (!show_tooltip) {
            return;
        }

        this.stop_out_timer();
        this.start_in_timer();
    }
    on_leave() {
        this.stop_in_timer();
        this.start_out_timer();
    }
    start_in_timer() {
        if (!this.in_to) {
            this.in_to = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.extension._Schema.get_int('tooltip-delay-ms'),
                this.show_tip.bind(this),
            );
        }
    }
    stop_in_timer() {
        if (this.in_to) {
            GLib.Source.remove(this.in_to);
            this.in_to = 0;
        }
    }
    start_out_timer() {
        if (!this.out_to) {
            this.out_to = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.extension._Schema.get_int('tooltip-delay-ms'),
                this.hide_tip.bind(this),
            );
        }
    }
    stop_out_timer() {
        if (this.out_to) {
            GLib.Source.remove(this.out_to);
            this.out_to = 0;
        }
    }
    destroy() {
        this.stop_in_timer();
        this.stop_out_timer();
        if (this.tipmenu) {
            this.tipmenu.destroy();
            this.tipmenu = null;
        }
        this.actor.destroy();
    }
}

// This class swaps the vertical and horizontal dimensions of a child element,
// because rotating the child only changes how it is painted, not its geometry.
// It also moves the bounds on allocation so that the rotated child ends up in
// the right position.
export const RotateBinLayout = GObject.registerClass(
    {
        GTypeName: 'RotateBinLayout'
    },
    class SystemMonitor_RotateBinLayout extends Clutter.BinLayout {
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

export const ElementBase = class SystemMonitor_ElementBase extends TipBox {
    /**
     * Minimal widget example:
     *
     *   class LoadAvg extends ElementBase {
     *       static metadata = {
     *           name: 'Load',
     *           metrics: [{ key: 'load1', color: true }],
     *       };
     *       collect() {
     *           let [, c] = Gio.File.new_for_path('/proc/loadavg').load_contents(null);
     *           return { load1: parseFloat(new TextDecoder().decode(c)) };
     *       }
     *   }
     *
     * metadata fields:
     *   name           (required) - Display name, also used to derive panel label
     *   metrics        (required) - Chart series: [{ key: 'name', color: true }, ...]
     *   id             (optional) - Type identifier, defaults to name.toLowerCase()
     *   label          (optional) - Short panel label, defaults to name.toLowerCase().slice(0,4)
     *   panelUnit      (optional) - Unit in panel text, default '%'
     *   menuUnit       (optional) - Unit in popup menu, default panelUnit
     *   tooltipUnit    (optional) - Unit in tooltip, default ''
     *   panelLayout    (optional) - 'simple' (default), 'dual', or 'icon'
     *   menuLayout     (optional) - 'simple' (default), 'detail', or 'dual'
     *   dualLabels     (optional) - Text labels for dual panel, e.g. ['R','W']
     *   dualIcons      (optional) - Icon names for dual panel (overrides dualLabels)
     *   menuDualLabels (optional) - Labels for dual menu (defaults to dualLabels)
     *   panelIcon      (optional) - Icon string for 'icon' panel layout
     *   panelValueStyle(optional) - Panel value CSS class, default 'sm-status-value'
     *   panelUnitStyle (optional) - Panel unit CSS class, default derived from unit
     *   detailUnit     (optional) - Initial detail unit for 'detail' menu layout
     *
     * Widget API (implement one of these patterns):
     *   collect()                - Return {metricKey: value}; framework auto-updates display
     *   collectAsync(callback)   - Same but async; call callback({metricKey: value}) when ready
     *
     * collect()/collectAsync() return keys:
     *   <metricKey>    - Raw values for chart and default tooltip
     *   display        - Primary display text (default: first metric stringified)
     *   display2       - Second value for dual layouts
     *   menuDisplay    - Menu-specific display (overrides display for menu)
     *   detail         - Detail text for 'detail' menu layout
     *   detailUnit     - Dynamic detail unit text
     *   unit           - Dynamic unit text (updates panel + menu)
     *   unit2          - Dynamic second unit for dual layouts
     *   icon           - Gio.Icon for 'icon' panel layout
     *   tipVals        - Array overriding auto-mapped tooltip values
     *   tipUnits       - Array overriding tooltip unit labels
     *
     * Constructor receives a config object with per-instance settings:
     *   { uuid, type, device, display, style, graph-width, refresh-time,
     *     show-text, show-menu, colors, ... }
     */
    constructor(extension, config) {
        super(extension);

        this.config = config;
        const meta = this.constructor.metadata;

        this.elt = meta?.id || meta?.name?.toLowerCase() || config.type;
        this.item_name = meta ? _(meta.name) : '';
        this.color_name = meta ? meta.metrics.filter(m => m.color).map(m => m.key) : [];
        this.device_id = config.device;
        this.text_items = [];
        this.menu_items = [];
        this.menu_visible = true;
        this.timeout = null;
        this._updateErrorLogged = false;
        this._asyncGen = 0;

        // Maximum value preserved during cooldown period
        this.graph_scale_max_including_cooldown = 0;
        this.graph_scale_cooldown_timer_id = null;
        this.graph_scale_cooldown_delay_minutes = 0;

        this.vals = [];
        this.tip_labels = [];
        this.tip_vals = [];
        this.tip_unit_labels = [];

        const Style = extension._Style;
        const IconSize = extension._IconSize;

        this.colors = [];
        for (let color of this.color_name) {
            let clutterColor = color_from_string(this.config.colors[color] || '#ff0000');
            this.colors.push(clutterColor);
        }

        let element_width = this.config['graph-width'];
        if (Style.get('') === '-compact') {
            element_width = Math.round(element_width / 1.5);
        }
        this.chart = new Chart(this.extension, element_width, IconSize, this);

        this.actor.visible = this.config.display;

        const panelLabel = meta?.label || meta?.name?.toLowerCase()?.slice(0, 4) || this.elt;
        this.label = new St.Label({text: _(panelLabel),
            style_class: Style.get('sm-status-label')});
        this.label.visible = this.config['show-text'];

        this.menu_visible = this.config['show-menu'];

        this.label_bin = new St.Bin({child: this.label});
        const default_layout = this.label_bin.layout_manager;
        const change_rotate_labels = () => {
            if (this.extension._Schema.get_boolean('rotate-labels')) {
                this.label.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, -90);
                this.label.add_style_class_name('rotated');
                this.label_bin.layout_manager = new RotateBinLayout();
                this.label_bin.y_align = Clutter.ActorAlign.CENTER;
            } else {
                this.label.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, 0);
                this.label.remove_style_class_name('rotated');
                this.label_bin.layout_manager = default_layout;
                this.label_bin.y_align = Clutter.ActorAlign.START;
            }
        };
        change_rotate_labels();

        this.actor.add_child(this.label_bin);
        this.text_box = new St.BoxLayout();

        this.actor.add_child(this.text_box);
        this.text_items = this.create_text_items();
        for (let item in this.text_items) {
            this.text_box.add_child(this.text_items[item]);
        }
        this.actor.add_child(this.chart.actor);
        change_style.call(this);

        this.menu_items = this.create_menu_items();

        this.restart_cooldown_timer();

        this.extension._Schema.connectObject(
            'changed::rotate-labels', change_rotate_labels,
            'changed::graph-cooldown-delay-m', () => {
                this.restart_cooldown_timer();
            },
            this
        );

        this.tip_format(meta?.tooltipUnit ?? '');
    }
    _activateTimers() {
        this.restart_update_timer(l_limit(this.config['refresh-time']));
        this._initialUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._initialUpdateId = null;
            this.update();
            return GLib.SOURCE_REMOVE;
        });
    }
    onSettingsChanged(newConfig) {
        const oldConfig = this.config;
        this.config = newConfig;

        if (oldConfig.display !== newConfig.display) {
            this.actor.visible = newConfig.display;
        }

        if (oldConfig['refresh-time'] !== newConfig['refresh-time']) {
            this.restart_update_timer(l_limit(newConfig['refresh-time']));
        }

        if (oldConfig['graph-width'] !== newConfig['graph-width']) {
            this.resize(newConfig['graph-width']);
        }

        this.colors = [];
        for (let color of this.color_name) {
            let clutterColor = color_from_string(this.config.colors[color] || '#ff0000');
            this.colors.push(clutterColor);
        }
        this.chart.actor.queue_repaint();

        if (oldConfig['show-text'] !== newConfig['show-text']) {
            this.label.visible = newConfig['show-text'];
        }

        if (oldConfig.style !== newConfig.style) {
            change_style.call(this);
        }

        if (oldConfig['show-menu'] !== newConfig['show-menu']) {
            this.menu_visible = newConfig['show-menu'];
            build_menu_info(this.extension);
        }

        this.update();
    }
    create_text_items() {
        const Style = this.extension._Style;
        const IconSize = this.extension._IconSize;
        const meta = this.constructor.metadata;
        const panelLayout = meta?.panelLayout ?? 'simple';
        const unit = meta?.panelUnit ?? '%';
        const valueStyle = meta?.panelValueStyle ?? 'sm-status-value';
        const unitStyle = meta?.panelUnitStyle ?? (unit === '%' ? 'sm-perc-label' : 'sm-unit-label');

        if (panelLayout === 'dual') {
            const labels = meta?.dualLabels ?? ['1', '2'];
            const icons = meta?.dualIcons;
            const items = [];
            for (let i = 0; i < 2; i++) {
                if (icons) {
                    items.push(new St.Icon({
                        icon_size: 2 * IconSize / 3 * Style.iconsize(),
                        icon_name: icons[i]}));
                } else {
                    items.push(new St.Label({
                        text: _(labels[i]),
                        style_class: Style.get('sm-status-label')}));
                }
                items.push(new St.Label({
                    text: '',
                    style_class: Style.get(valueStyle),
                    y_align: Clutter.ActorAlign.CENTER}));
                items.push(new St.Label({
                    text: _(unit),
                    style_class: Style.get(unitStyle),
                    y_align: Clutter.ActorAlign.CENTER}));
            }
            return items;
        }

        if (panelLayout === 'icon') {
            const iconName = meta?.panelIcon ?? 'dialog-question-symbolic';
            return [
                new St.Icon({
                    gicon: Gio.icon_new_for_string(iconName),
                    style_class: Style.get('sm-status-icon')}),
                new St.Label({
                    text: '',
                    style_class: Style.get(valueStyle),
                    y_align: Clutter.ActorAlign.CENTER}),
                new St.Label({
                    text: _(unit),
                    style_class: Style.get(unitStyle),
                    y_align: Clutter.ActorAlign.CENTER}),
            ];
        }

        return [
            new St.Label({
                text: '',
                style_class: Style.get(valueStyle),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: _(unit),
                style_class: Style.get(unitStyle),
                y_align: Clutter.ActorAlign.CENTER}),
        ];
    }
    create_menu_items() {
        const Style = this.extension._Style;
        const meta = this.constructor.metadata;
        const menuLayout = meta?.menuLayout ?? 'simple';
        const unit = meta?.menuUnit ?? meta?.panelUnit ?? '%';

        if (menuLayout === 'detail') {
            const detailUnit = meta?.detailUnit ?? '';
            return [
                new St.Label({text: '', style_class: Style.get('sm-value')}),
                new St.Label({text: _(unit), style_class: Style.get('sm-label')}),
                new St.Label({text: '', style_class: Style.get('sm-label')}),
                new St.Label({text: '', style_class: Style.get('sm-value')}),
                new St.Label({text: _(detailUnit), style_class: Style.get('sm-label')}),
            ];
        }

        if (menuLayout === 'dual') {
            const labels = meta?.menuDualLabels ?? meta?.dualLabels ?? ['1', '2'];
            return [
                new St.Label({text: '', style_class: Style.get('sm-value')}),
                new St.Label({text: _(unit), style_class: Style.get('sm-label')}),
                new St.Label({text: ' ' + _(labels[0]), style_class: Style.get('sm-label')}),
                new St.Label({text: '', style_class: Style.get('sm-value')}),
                new St.Label({text: _(unit), style_class: Style.get('sm-label')}),
                new St.Label({text: ' ' + _(labels[1]), style_class: Style.get('sm-label')}),
            ];
        }

        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: _(unit),
                style_class: Style.get('sm-label')}),
        ];
    }
    /**
     * Initializes or restarts the graph scale cooldown timer. The graph
     * scale won't downscale during the cooldown period.
     *
     * max - Maximum value to preserve during cooldown
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
                    if (this._destroyed) return GLib.SOURCE_REMOVE;
                    this.graph_scale_cooldown_timer_id = null;
                    this.restart_cooldown_timer();
                    return GLib.SOURCE_REMOVE;
                });
        }
    }
    restart_update_timer(interval = null) {
        interval = interval || this._lastInterval;
        if (!interval) {
            sm_log("Invalid call to restart_update_timer", 'error');
            return;
        }
        if (this.timeout) {
            GLib.Source.remove(this.timeout);
        }
        this.timeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE,
            interval,
            this.update.bind(this),
        );
        this._lastInterval = interval;
    }
    tip_format(unit) {
        if (typeof (unit) === 'undefined') {
            unit = '%';
        }
        if (typeof (unit) === 'string') {
            let all_unit = unit;
            unit = [];
            for (let i = 0; i < this.color_name.length; i++) {
                unit.push(all_unit);
            }
        }
        // The base constructor already builds a default set of rows; widgets
        // calling this again with custom units must replace them, not append
        // a second set.
        this.tipmenu.removeAll();
        this.tip_labels = [];
        this.tip_unit_labels = [];
        this.tip_vals = [];
        for (let i = 0; i < this.color_name.length; i++) {
            let tipline = new TipItem();
            this.tipmenu.addMenuItem(tipline);
            tipline.actor.add_child(new St.Label({text: _(this.color_name[i])}));
            this.tip_labels[i] = new St.Label({text: ''});
            tipline.actor.add_child(this.tip_labels[i]);

            this.tip_unit_labels[i] = new St.Label({text: unit[i]});
            tipline.actor.add_child(this.tip_unit_labels[i]);
            this.tip_vals[i] = 0;
        }
    }
    //        set_tip_unit: function(unit) {
    //           for (let i = 0;i < this.tip_unit_labels.length;i++) {
    //           this.tip_unit_labels[i].text = unit[i];
    //           }
    //           }
    update() {
        if (this._destroyed)
            return GLib.SOURCE_REMOVE;
        if (!this.menu_visible && !this.actor.visible) {
            return GLib.SOURCE_CONTINUE;
        }
        // A throw escaping a GLib source callback removes the source, which
        // would silently stop this widget's updates until shell restart —
        // never let collection errors propagate out of here.
        try {
            if (this.collect) {
                this._applyCollected(this.collect());
            } else if (this.collectAsync) {
                if (!this._asyncPending) {
                    this._asyncPending = true;
                    const gen = ++this._asyncGen;
                    if (this._asyncTimeoutId)
                        GLib.Source.remove(this._asyncTimeoutId);
                    this._asyncTimeoutId = GLib.timeout_add_seconds(
                        GLib.PRIORITY_DEFAULT, 30, () => {
                            this._asyncTimeoutId = null;
                            if (this._asyncPending && this._asyncGen === gen) {
                                sm_log(`${this.elt}: async collect timed out`, 'warn');
                                this._asyncPending = false;
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    this.collectAsync(data => {
                        if (this._asyncGen !== gen)
                            return;
                        this._asyncPending = false;
                        if (this._asyncTimeoutId) {
                            GLib.Source.remove(this._asyncTimeoutId);
                            this._asyncTimeoutId = null;
                        }
                        if (this._destroyed)
                            return;
                        this._applyCollected(data);
                    });
                }
            } else {
                this.refresh();
                this._apply();
                this._postApply();
                this._updateErrorLogged = false;
            }
        } catch (e) {
            this._logUpdateError(e);
        }
        return GLib.SOURCE_CONTINUE;
    }
    _applyCollected(data) {
        try {
            if (data)
                this._autoApply(data);
            this._postApply();
            this._updateErrorLogged = false;
        } catch (e) {
            this._logUpdateError(e);
        }
    }
    _logUpdateError(e) {
        if (this._updateErrorLogged)
            return;
        this._updateErrorLogged = true;
        sm_log(`${this.elt}: update failed: ${e}`, 'error');
    }
    _postApply() {
        this.chart.update();
        for (let i = 0; i < this.tip_vals.length; i++) {
            if (this.tip_labels[i])
                this.tip_labels[i].text = this.tip_vals[i].toString();
        }
    }
    _autoApply(data) {
        const meta = this.constructor.metadata;
        const metrics = this.color_name;
        const metricData = data.metrics || {};
        for (let i = 0; i < metrics.length; i++) {
            let val = metricData[metrics[i]];
            if (val !== undefined) {
                this.vals[i] = typeof val === 'number' ? val : parseFloat(val) || 0;
                this.tip_vals[i] = val;
            }
        }
        if (data.tipVals) {
            for (let i = 0; i < data.tipVals.length; i++)
                this.tip_vals[i] = data.tipVals[i];
        }
        if (data.tipUnits) {
            for (let i = 0; i < data.tipUnits.length; i++) {
                if (this.tip_unit_labels[i])
                    this.tip_unit_labels[i].text = data.tipUnits[i];
            }
        }

        let display = data.display;
        if (display === undefined) {
            let primaryKey = metrics[0];
            if (primaryKey !== undefined && metricData[primaryKey] !== undefined)
                display = metricData[primaryKey].toString();
        }

        this._applyPanel(data, display, meta?.panelLayout ?? 'simple');
        this._applyMenu(data, data.menuDisplay ?? display, meta?.menuLayout ?? 'simple');

        if (this.format)
            this.format(data);
    }
    _applyPanel(data, display, layout) { // eslint-disable-line complexity
        if (layout === 'dual') {
            if (display !== undefined && this.text_items[1])
                this.text_items[1].text = display;
            if (data.display2 !== undefined && this.text_items[4])
                this.text_items[4].text = data.display2;
            if (data.unit !== undefined && this.text_items[2])
                this.text_items[2].text = data.unit;
            if (data.unit2 !== undefined && this.text_items[5])
                this.text_items[5].text = data.unit2;
        } else if (layout === 'icon') {
            if (display !== undefined && this.text_items[1])
                this.text_items[1].text = display;
            if (data.icon !== undefined && this.text_items[0])
                this.text_items[0].gicon = data.icon;
            if (data.unit !== undefined && this.text_items[2])
                this.text_items[2].text = data.unit;
        } else {
            if (display !== undefined && this.text_items[0])
                this.text_items[0].text = display;
            if (data.unit !== undefined && this.text_items[1])
                this.text_items[1].text = data.unit;
        }
    }
    _applyMenu(data, display, layout) { // eslint-disable-line complexity
        if (layout === 'dual') {
            let display2 = data.menuDisplay2 ?? data.display2;
            let menuUnit = data.menuUnit ?? data.unit;
            let menuUnit2 = data.menuUnit2 ?? data.unit2;
            if (display !== undefined && this.menu_items[0])
                this.menu_items[0].text = display;
            if (display2 !== undefined && this.menu_items[3])
                this.menu_items[3].text = display2;
            if (menuUnit !== undefined && this.menu_items[1])
                this.menu_items[1].text = menuUnit;
            if (menuUnit2 !== undefined && this.menu_items[4])
                this.menu_items[4].text = menuUnit2;
        } else if (layout === 'detail') {
            if (display !== undefined && this.menu_items[0])
                this.menu_items[0].text = display;
            if (data.detail !== undefined && this.menu_items[3])
                this.menu_items[3].text = data.detail;
            if (data.detailUnit !== undefined && this.menu_items[4])
                this.menu_items[4].text = data.detailUnit;
        } else {
            if (display !== undefined && this.menu_items[0])
                this.menu_items[0].text = display;
            if (data.unit !== undefined && this.menu_items[1])
                this.menu_items[1].text = data.unit;
        }
    }
    resize(width) {
        if (this.extension._Style.get('') === '-compact') {
            width = Math.round(width / 1.5);
        }
        this.chart.resize(width);
    }
    destroy() {
        this._destroyed = true;
        this.extension._Schema.disconnectObject(this);
        if (this.chart)
            this.chart.destroy();
        TipBox.prototype.destroy.call(this);
        if (this._initialUpdateId) {
            GLib.Source.remove(this._initialUpdateId);
            this._initialUpdateId = null;
        }
        if (this.timeout) {
            GLib.Source.remove(this.timeout);
            this.timeout = null;
        }
        if (this.graph_scale_cooldown_timer_id) {
            GLib.Source.remove(this.graph_scale_cooldown_timer_id);
            this.graph_scale_cooldown_timer_id = null;
        }
        if (this._asyncTimeoutId) {
            GLib.Source.remove(this._asyncTimeoutId);
            this._asyncTimeoutId = null;
        }
    }
}
