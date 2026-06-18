/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

'use strict';

import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Adw from "gi://Adw";

import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { parse_bytearray } from './common.js';

const N_ = function (e) {
    return e;
};

function capitalize(str) {
    return str.replace(/(^|\s)([a-z])/g, function (_m, p1, p2) {
        return p1 + p2.toUpperCase();
    });
}

function color_to_hex(color) {
    let output = N_('#%02x%02x%02x%02x').format(
        255 * color.red,
        255 * color.green,
        255 * color.blue,
        255 * color.alpha);
    return output;
}

// ** General Preferences Page **
const SMGeneralPrefsPage = GObject.registerClass({
    GTypeName: 'SMGeneralPrefsPage',
    Template: import.meta.url.replace('prefs.js', 'ui/prefsGeneralSettings.ui'),
    InternalChildren: ['background', 'icon_display', 'show_tooltip', 'move_clock',
        'compact_display', 'center_display', 'left_display', 'rotate_labels',
        'tooltip_delay_ms', 'graph_delay_m', 'disk_usage_style',
        'custom_monitor_switch', 'custom_monitor_command'],
}, class SMGeneralPrefsPage extends Adw.PreferencesPage {
    constructor(settings, params = {}) {
        super(params);

        this._settings = settings;

        let color = new Gdk.RGBA();
        color.parse(this._settings.get_string('background'));
        this._background.set_rgba(color);

        let colorDialog = new Gtk.ColorDialog({
            modal: true,
            with_alpha: true,
        });
        this._background.set_dialog(colorDialog);

        this._background.connect('notify::rgba', colorButton => {
            this._settings.set_string('background', color_to_hex(colorButton.get_rgba()));
        });
        this._settings.connect('changed::background', () => {
            color.parse(this._settings.get_string('background'));
            this._background.set_rgba(color);
        });

        this._settings.bind('icon-display', this._icon_display,
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind('show-tooltip', this._show_tooltip,
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind('move-clock', this._move_clock,
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind('compact-display', this._compact_display,
            'active', Gio.SettingsBindFlags.DEFAULT
        );

        this._settings.bind('center-display', this._center_display,
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind('left-display', this._left_display,
            'active', Gio.SettingsBindFlags.DEFAULT
        );

        // to alternately disable positioning options
        this._center_display.connect('notify::active', () => {
            if (this._center_display.active) {
                this._settings.set_boolean('left-display', false);
            }
        })
        this._left_display.connect('notify::active', () => {
            if (this._left_display.active) {
                this._settings.set_boolean('center-display', false);
            }
        })

        this._settings.bind('rotate-labels', this._rotate_labels,
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind('tooltip-delay-ms', this._tooltip_delay_ms,
            'value', Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind('graph-cooldown-delay-m', this._graph_delay_m,
            'value', Gio.SettingsBindFlags.DEFAULT
        );

        // Enum key: bind() can't map a combo index to the enum nick.
        this._disk_usage_style.selected = this._settings.get_enum('disk-usage-style');
        this._disk_usage_style.connect('notify::selected', w => {
            this._settings.set_enum('disk-usage-style', w.selected);
        });

        const hasCommand = this._settings.get_string('custom-monitor-command').trim() !== '';
        this._custom_monitor_switch.active = hasCommand;
        this._custom_monitor_command.visible = hasCommand;

        this._custom_monitor_switch.connect('notify::active', () => {
            this._custom_monitor_command.visible = this._custom_monitor_switch.active;
            if (!this._custom_monitor_switch.active) {
                this._settings.set_string('custom-monitor-command', '');
            }
        });

        this._settings.bind('custom-monitor-command', this._custom_monitor_command,
            'text', Gio.SettingsBindFlags.DEFAULT
        );
    }
});

// ** Monitor Configuration Constants **

const MONITOR_TYPES = ['cpu', 'memory', 'swap', 'net', 'disk', 'gpu', 'thermal', 'fan', 'battery', 'freq', 'prometheus'];

const COLOR_MAP = {
    cpu: ['user', 'system', 'nice', 'iowait', 'other'],
    memory: ['program', 'buffer', 'cache'],
    swap: ['used'],
    net: ['down', 'downerrors', 'up', 'uperrors', 'collisions'],
    disk: ['read', 'write'],
    gpu: ['used', 'memory'],
    thermal: ['tz0'],
    fan: ['fan0'],
    battery: ['batt0'],
    freq: ['freq'],
    prometheus: ['value'],
};

const DEFAULT_COLORS = {
    cpu: {user: '#0072b3', system: '#0092e6', nice: '#00a3ff', iowait: '#002f3d', other: '#001d26'},
    memory: {program: '#00b35b', buffer: '#00ff82', cache: '#aaf5d0'},
    swap: {used: '#8b00c3'},
    net: {down: '#fce94f', downerrors: '#ff6e00', up: '#fb74fb', uperrors: '#e0006e', collisions: '#ff0000'},
    disk: {read: '#c65000', write: '#ff6700'},
    gpu: {used: '#00b35b', memory: '#00ff82'},
    thermal: {tz0: '#f2002e'},
    fan: {fan0: '#f2002e'},
    battery: {batt0: '#f2002e'},
    freq: {freq: '#001d26'},
    prometheus: {value: '#00b3a4'},
};

const STYLE_OPTIONS = ['digit', 'graph', 'both'];

// ** Device Detection **

function getCpuCores() {
    try {
        let file = Gio.File.new_for_path('/proc/cpuinfo');
        let [success, contents] = file.load_contents(null);
        if (success) {
            let text = new TextDecoder().decode(contents);
            let matches = text.match(/^processor/gm);
            let count = matches ? matches.length : 1;
            return Array.from({length: count}, (_v, i) => i.toString());
        }
    } catch {
        // fall through
    }
    return ['0'];
}

function getNetInterfaces() {
    try {
        let file = Gio.File.new_for_path('/proc/net/dev');
        let [success, contents] = file.load_contents(null);
        if (success) {
            let lines = new TextDecoder().decode(contents).split('\n');
            let ifaces = [];
            for (let i = 2; i < lines.length; i++) {
                let iface = lines[i].trim().split(':')[0];
                if (iface && iface !== 'lo')
                    ifaces.push(iface);
            }
            return ifaces;
        }
    } catch {
        // fall through
    }
    return [];
}

function getDiskDevices() {
    try {
        let file = Gio.File.new_for_path('/proc/diskstats');
        let [success, contents] = file.load_contents(null);
        if (success) {
            let lines = new TextDecoder().decode(contents).split('\n');
            let disks = new Set();
            for (let line of lines) {
                let parts = line.trim().split(/\s+/);
                if (parts.length > 2) {
                    let disk = parts[2];
                    if (disk && /^(sd[a-z]|nvme\d+n\d+|mmcblk\d+|vd[a-z])$/.test(disk))
                        disks.add(disk);
                }
            }
            return Array.from(disks);
        }
    } catch {
        // fall through
    }
    return [];
}

function getGpuDevices() {
    try {
        let [success, stdout] = GLib.spawn_command_line_sync(
            'nvidia-smi --query-gpu=count --format=csv,noheader');
        if (success) {
            let count = parseInt(new TextDecoder().decode(stdout).trim(), 10);
            if (!isNaN(count) && count > 0)
                return Array.from({length: count}, (_v, i) => i.toString());
        }
    } catch {
        // nvidia-smi not available
    }
    try {
        let drmDir = Gio.File.new_for_path('/sys/class/drm/');
        let enumerator = drmDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let count = 0;
        let fileInfo;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            if (/^card\d+$/.test(fileInfo.get_name()))
                count++;
        }
        enumerator.close(null);
        if (count > 0)
            return Array.from({length: count}, (_v, i) => i.toString());
    } catch {
        // fall through
    }
    return ['0'];
}

function detectSensors(sensorType) {
    const sensors = {};
    try {
        const hwmonDir = Gio.File.new_for_path('/sys/class/hwmon/');
        const hwmonEnum = hwmonDir.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let hwmonInfo;
        while ((hwmonInfo = hwmonEnum.next_file(null))) {
            if (hwmonInfo.get_file_type() !== Gio.FileType.DIRECTORY ||
                !hwmonInfo.get_name().match(/^hwmon\d+$/))
                continue;
            const chip = hwmonEnum.get_child(hwmonInfo);
            let chipLabel = chip.get_basename();
            try {
                let [ok, c] = chip.get_child('name').load_contents(null);
                if (ok) chipLabel = parse_bytearray(c).trim();
            } catch { /* no name file */ }

            const chipEnum = chip.enumerate_children(
                'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            const regex = new RegExp(`^${sensorType}(\\d+)_input$`);
            let fInfo;
            while ((fInfo = chipEnum.next_file(null))) {
                const m = fInfo.get_name().match(regex);
                if (!m) continue;
                let inputLabel = m[1];
                try {
                    let [ok, c] = chip.get_child(`${sensorType}${m[1]}_label`).load_contents(null);
                    if (ok) inputLabel = parse_bytearray(c).trim();
                } catch { /* no label file */ }
                sensors[`${chipLabel} - ${inputLabel}`] = true;
            }
        }
    } catch { /* hwmon unavailable */ }
    return Object.keys(sensors);
}

function detectDevices(type) {
    switch (type) {
    case 'cpu':
    case 'freq':
        return ['all', ...getCpuCores()];
    case 'memory':
    case 'swap':
    case 'battery':
        return ['default'];
    case 'net':
        return ['all', ...getNetInterfaces()];
    case 'disk':
        return ['all', ...getDiskDevices()];
    case 'gpu':
        return getGpuDevices();
    case 'thermal':
        return detectSensors('temp');
    case 'fan':
        return detectSensors('fan');
    case 'prometheus':
        return ['default'];
    default:
        return ['all'];
    }
}

function buildDefaultConfig(type, device) {
    let config = {
        uuid: GLib.uuid_string_random(),
        type: type,
        device: device,
        display: true,
        style: 'graph',
        'graph-width': 100,
        'refresh-time': type === 'cpu' || type === 'freq' ? 1500 : 5000,
        'show-text': true,
        'show-menu': true,
        colors: {...(DEFAULT_COLORS[type] || {})},
    };
    if (type === 'thermal') {
        config['fahrenheit-unit'] = false;
        config['threshold'] = 0;
    }
    if (type === 'net')
        config['speed-in-bits'] = false;
    if (type === 'battery') {
        config['time'] = false;
        config['hidesystem'] = false;
    }
    if (type === 'freq')
        config['display-mode'] = 'max';
    if (type === 'prometheus') {
        config.server = 'http://localhost:9100';
        config.metric = 'node_load1';
    }
    return config;
}

// ** Monitor Row **

const SMMonitorRow = GObject.registerClass({
    GTypeName: 'SMMonitorRow',
    Signals: {
        'config-changed': {},
        'delete-requested': {},
    },
}, class SMMonitorRow extends Adw.ExpanderRow {
    constructor(config, params = {}) {
        super(params);

        this._config = config;
        this._colorDialog = new Gtk.ColorDialog({modal: true, with_alpha: true});
        this._dragX = 0;
        this._dragY = 0;

        this.title = this._formatTitle();

        let dragHandle = new Gtk.Image({
            icon_name: 'list-drag-handle-symbolic',
            css_classes: ['drag-handle'],
            valign: Gtk.Align.CENTER,
        });
        this.add_prefix(dragHandle);

        let displaySwitch = new Gtk.Switch({
            active: config.display,
            valign: Gtk.Align.CENTER,
        });
        displaySwitch.connect('notify::active', w => {
            config.display = w.active;
            this._emitChanged();
        });
        this.add_suffix(displaySwitch);

        let deleteBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        deleteBtn.connect('clicked', () => this.emit('delete-requested'));
        this.add_suffix(deleteBtn);

        let dragSource = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        dragSource.connect('prepare', this._onDragPrepare.bind(this));
        dragSource.connect('drag-begin', this._onDragBegin.bind(this));
        this.add_controller(dragSource);

        let dropTarget = Gtk.DropTarget.new(SMMonitorRow.$gtype, Gdk.DragAction.MOVE);
        dropTarget.connect('drop', this._onDrop.bind(this));
        this.add_controller(dropTarget);

        this._buildSettings();
    }

    _formatTitle() {
        let type = capitalize(this._config.type);
        let device = this._config.device;
        if (device === 'default' || device === '')
            return type;
        return `${type} — ${device}`;
    }

    _onDragPrepare(_source, x, y) {
        this._dragX = x;
        this._dragY = y;
        let value = new GObject.Value();
        value.init(SMMonitorRow);
        value.set_object(this);
        return Gdk.ContentProvider.new_for_value(value);
    }

    _onDragBegin(_source, drag) {
        let dragWidget = new Gtk.ListBox();
        dragWidget.set_size_request(this.get_width(), this.get_height());
        let label = new Adw.ActionRow({title: this.title});
        dragWidget.append(label);
        dragWidget.drag_highlight_row(label);
        let icon = Gtk.DragIcon.get_for_drag(drag);
        icon.set_child(dragWidget);
        drag.set_hotspot(this._dragX, this._dragY);
    }

    _onDrop(_target, value, _x, _y) {
        if (value === this)
            return false;
        let listBox = this.get_parent();
        let fromIndex = value.get_index();
        let toIndex = this.get_index();
        listBox.remove(value);
        let updatedToIndex = this.get_index();
        if (fromIndex < toIndex)
            listBox.insert(value, updatedToIndex + 1);
        else
            listBox.insert(value, updatedToIndex);
        this.emit('config-changed');
        return true;
    }

    _emitChanged() {
        this.emit('config-changed');
    }

    _buildSettings() {
        let c = this._config;

        let showMenu = new Adw.SwitchRow({title: _('Show In Menu'), active: c['show-menu']});
        showMenu.connect('notify::active', w => { c['show-menu'] = w.active; this._emitChanged(); });
        this.add_row(showMenu);

        let showText = new Adw.SwitchRow({title: _('Show Text'), active: c['show-text']});
        showText.connect('notify::active', w => { c['show-text'] = w.active; this._emitChanged(); });
        this.add_row(showText);

        let styleModel = new Gtk.StringList();
        STYLE_OPTIONS.forEach(s => styleModel.append(_(s)));
        let styleRow = new Adw.ComboRow({
            title: _('Display Style'),
            model: styleModel,
            selected: STYLE_OPTIONS.indexOf(c.style),
        });
        styleRow.connect('notify::selected', w => {
            c.style = STYLE_OPTIONS[w.selected];
            this._emitChanged();
        });
        this.add_row(styleRow);

        let graphWidth = new Adw.SpinRow({
            title: _('Graph Width'),
            numeric: true,
            adjustment: new Gtk.Adjustment({
                value: c['graph-width'], lower: 1, upper: 1000,
                step_increment: 1, page_increment: 10,
            }),
        });
        graphWidth.value = c['graph-width'];
        this.add_row(graphWidth);
        graphWidth.connect('notify::value', w => {
            c['graph-width'] = w.value;
            this._emitChanged();
        });

        let refreshTime = new Adw.SpinRow({
            title: _('Refresh Time'),
            subtitle: 'ms',
            numeric: true,
            adjustment: new Gtk.Adjustment({
                value: c['refresh-time'], lower: 100, upper: 100000,
                step_increment: 500, page_increment: 5000,
            }),
        });
        refreshTime.value = c['refresh-time'];
        this.add_row(refreshTime);
        refreshTime.connect('notify::value', w => {
            c['refresh-time'] = w.value;
            this._emitChanged();
        });

        let colorNames = COLOR_MAP[c.type] || [];
        if (!c.colors) c.colors = {};
        for (let colorName of colorNames) {
            let actionRow = new Adw.ActionRow({title: _(capitalize(colorName))});
            let rgba = new Gdk.RGBA();
            rgba.parse(c.colors[colorName] || '#ff0000');
            let colorBtn = new Gtk.ColorDialogButton({
                valign: Gtk.Align.CENTER,
                dialog: this._colorDialog,
                rgba: rgba,
            });
            colorBtn.connect('notify::rgba', btn => {
                c.colors[colorName] = color_to_hex(btn.get_rgba());
                this._emitChanged();
            });
            actionRow.add_suffix(colorBtn);
            this.add_row(actionRow);
        }

        this._buildTypeSpecific(c);
    }

    _buildTypeSpecific(c) {
        switch (c.type) {
        case 'thermal': {
            let fahrenheit = new Adw.SwitchRow({
                title: _('Display temperature in Fahrenheit'),
                active: c['fahrenheit-unit'] || false,
            });
            fahrenheit.connect('notify::active', w => {
                c['fahrenheit-unit'] = w.active;
                this._emitChanged();
            });
            this.add_row(fahrenheit);

            let threshold = new Adw.SpinRow({
                title: _('Temperature threshold (0 to disable)'),
                numeric: true,
                adjustment: new Gtk.Adjustment({
                    value: c.threshold || 0, lower: 0, upper: 300,
                    step_increment: 5, page_increment: 10,
                }),
            });
            this.add_row(threshold);
            threshold.connect('notify::value', w => {
                c.threshold = w.value;
                this._emitChanged();
            });
            break;
        }
        case 'net': {
            let speedBits = new Adw.SwitchRow({
                title: _('Show network speed in bits'),
                active: c['speed-in-bits'] || false,
            });
            speedBits.connect('notify::active', w => {
                c['speed-in-bits'] = w.active;
                this._emitChanged();
            });
            this.add_row(speedBits);
            break;
        }
        case 'battery': {
            let showTime = new Adw.SwitchRow({
                title: _('Show Time Remaining'),
                active: c.time || false,
            });
            showTime.connect('notify::active', w => {
                c.time = w.active;
                this._emitChanged();
            });
            this.add_row(showTime);

            let hideIcon = new Adw.SwitchRow({
                title: _('Hide System Icon'),
                active: c.hidesystem || false,
            });
            hideIcon.connect('notify::active', w => {
                c.hidesystem = w.active;
                this._emitChanged();
            });
            this.add_row(hideIcon);
            break;
        }
        case 'freq': {
            let modes = ['max', 'average'];
            let modeModel = new Gtk.StringList();
            modeModel.append(_('Max across all cores'));
            modeModel.append(_('Average across all cores'));
            let modeRow = new Adw.ComboRow({
                title: _('Display Mode'),
                model: modeModel,
                selected: modes.indexOf(c['display-mode'] || 'max'),
            });
            modeRow.connect('notify::selected', w => {
                c['display-mode'] = modes[w.selected];
                this._emitChanged();
            });
            this.add_row(modeRow);
            break;
        }
        case 'prometheus': {
            let serverRow = new Adw.EntryRow({
                title: _('Exporter URL'),
                text: c.server || 'http://localhost:9100',
            });
            serverRow.connect('changed', w => {
                c.server = w.text;
                this._emitChanged();
            });
            this.add_row(serverRow);

            let metricRow = new Adw.EntryRow({
                title: _('Metric (e.g. node_load1 or metric{label="val"})'),
                text: c.metric || 'node_load1',
            });
            metricRow.connect('changed', w => {
                c.metric = w.text;
                this._emitChanged();
            });
            this.add_row(metricRow);
            break;
        }
        }
    }
});

// ** Monitors Preferences Page **

const SMMonitorsPage = GObject.registerClass({
    GTypeName: 'SMMonitorsPage',
}, class SMMonitorsPage extends Adw.PreferencesPage {
    constructor(settings, params = {}) {
        super({
            title: _('Monitors'),
            icon_name: 'utilities-system-monitor-symbolic',
            ...params,
        });

        this._settings = settings;
        this._monitors = [];
        this._saveTimerId = null;
        this.connect('destroy', () => {
            if (this._saveTimerId) {
                GLib.Source.remove(this._saveTimerId);
                this._saveTimerId = null;
            }
        });

        let group = new Adw.PreferencesGroup({
            title: _('Active Monitors'),
            description: _('Drag to reorder. Changes apply immediately.'),
        });
        this.add(group);

        this._listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        group.add(this._listBox);

        this._loadMonitors();
        for (let config of this._monitors)
            this._addRow(config);

        let addGroup = new Adw.PreferencesGroup();
        this.add(addGroup);
        let addBtn = new Gtk.Button({
            label: _('Add Monitor…'),
            css_classes: ['suggested-action'],
            halign: Gtk.Align.CENTER,
            margin_top: 12,
        });
        addBtn.connect('clicked', () => this._onAddMonitor());
        addGroup.add(addBtn);
    }

    _loadMonitors() {
        let strv = this._settings.get_strv('monitors');
        this._monitors = [];
        for (const s of strv) {
            try {
                let c = JSON.parse(s);
                if (c && c.uuid && c.type)
                    this._monitors.push(c);
            } catch {
                console.warn('system-monitor-next: skipping malformed monitor config');
            }
        }
    }

    _saveMonitors() {
        if (this._saveTimerId)
            GLib.Source.remove(this._saveTimerId);
        this._saveTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._saveTimerId = null;
            let ordered = this._getOrderedConfigs();
            this._monitors = ordered;
            let strv = ordered.map(m => JSON.stringify(m));
            this._settings.set_strv('monitors', strv);
            return GLib.SOURCE_REMOVE;
        });
    }

    _getOrderedConfigs() {
        let configs = [];
        for (let child = this._listBox.get_first_child(); child; child = child.get_next_sibling()) {
            if (child instanceof SMMonitorRow)
                configs.push(child._config);
        }
        return configs;
    }

    _addRow(config) {
        let row = new SMMonitorRow(config);
        row.connect('config-changed', () => this._saveMonitors());
        row.connect('delete-requested', () => {
            this._listBox.remove(row);
            this._monitors = this._monitors.filter(m => m.uuid !== config.uuid);
            this._saveMonitors();
        });
        this._listBox.append(row);
    }

    _onAddMonitor() {
        let dialog = new Adw.Window({
            modal: true,
            title: _('Add Monitor'),
            default_width: 400,
            default_height: 280,
            transient_for: this.get_root(),
        });

        let toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(new Adw.HeaderBar());
        dialog.set_content(toolbar);

        let box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12, margin_bottom: 12,
            margin_start: 12, margin_end: 12,
        });
        toolbar.set_content(box);

        let group = new Adw.PreferencesGroup();
        box.append(group);

        let typeModel = new Gtk.StringList();
        MONITOR_TYPES.forEach(t => typeModel.append(_(capitalize(t))));
        let typeRow = new Adw.ComboRow({title: _('Type'), model: typeModel});
        group.add(typeRow);

        let deviceModel = new Gtk.StringList();
        let deviceRow = new Adw.ComboRow({title: _('Device'), model: deviceModel});
        group.add(deviceRow);

        let serverRow = new Adw.EntryRow({title: _('Exporter URL'), text: 'http://localhost:9100'});
        group.add(serverRow);
        let metricRow = new Adw.EntryRow({title: _('Metric (e.g. node_load1 or metric{label="val"})'), text: 'node_load1'});
        group.add(metricRow);

        let currentDevices = [];
        let addBtn; // created below with the button box
        const updateTypeUI = () => {
            let type = MONITOR_TYPES[typeRow.selected];
            let isPrometheus = type === 'prometheus';
            deviceRow.visible = !isPrometheus;
            serverRow.visible = isPrometheus;
            metricRow.visible = isPrometheus;
            let haveDevices = true;
            if (!isPrometheus) {
                currentDevices = detectDevices(type);
                let model = new Gtk.StringList();
                currentDevices.forEach(d => model.append(d));
                deviceRow.model = model;
                deviceRow.selected = 0;
                // E.g. thermal/fan on a machine with no readable sensors;
                // a monitor saved without a real device could never
                // resolve, so block the add instead.
                haveDevices = currentDevices.length > 0;
                deviceRow.subtitle = haveDevices ? '' : _('No devices detected');
            }
            addBtn.sensitive = haveDevices;
        };

        let btnBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
            margin_top: 8,
        });
        box.append(btnBox);

        let cancelBtn = new Gtk.Button({label: _('Cancel')});
        cancelBtn.connect('clicked', () => dialog.close());
        btnBox.append(cancelBtn);

        addBtn = new Gtk.Button({
            label: _('Add'),
            css_classes: ['suggested-action'],
        });
        addBtn.connect('clicked', () => {
            let type = MONITOR_TYPES[typeRow.selected];
            let device = currentDevices[deviceRow.selected] || 'all';
            let config = buildDefaultConfig(type, device);
            if (type === 'prometheus') {
                config.server = serverRow.text || 'http://localhost:9100';
                config.metric = metricRow.text || 'node_load1';
            }
            this._monitors.push(config);
            this._addRow(config);
            this._saveMonitors();
            dialog.close();
        });
        btnBox.append(addBtn);

        typeRow.connect('notify::selected', updateTypeUI);
        updateTypeUI();

        dialog.present();
    }
});

// ** What's New Page **

const PROJECT_URL = 'https://github.com/mgalgs/gnome-shell-system-monitor-next-applet';

const SMWhatsNewPage = GObject.registerClass({
    GTypeName: 'SMWhatsNewPage',
}, class SMWhatsNewPage extends Adw.PreferencesPage {
    constructor(params = {}) {
        super({
            title: _('About'),
            icon_name: 'dialog-information-symbolic',
            ...params,
        });

        let aboutGroup = new Adw.PreferencesGroup({
            title: 'System Monitor Next',
            description: _('Modular, config-driven system monitoring for your GNOME desktop. Add, remove, and reorder monitors freely — each with independent settings.'),
        });
        this.add(aboutGroup);

        let featuresGroup = new Adw.PreferencesGroup({
            title: _("What's New"),
        });
        this.add(featuresGroup);

        this._addFeatureRow(featuresGroup,
            'list-add-symbolic',
            _('Multi-Device Monitoring'),
            _('Add multiple instances of any monitor type. Track individual CPU cores, specific network interfaces, or separate GPU devices — each with its own colors and refresh rate.')
        );

        this._addFeatureRow(featuresGroup,
            'network-server-symbolic',
            _('Prometheus Metrics'),
            _('Graph any metric from a Prometheus-compatible exporter directly in your panel. Monitor custom application metrics, hardware sensors, or anything with a metrics endpoint — no code changes required.')
        );

        this._addFeatureRow(featuresGroup,
            'view-list-symbolic',
            _('Drag &amp; Drop Reordering'),
            _('Reorder monitors by dragging them in the Monitors tab. Changes apply instantly — no shell restart required.')
        );

        this._addFeatureRow(featuresGroup,
            'applications-graphics-symbolic',
            _('Theme Integration'),
            _("Panel widgets automatically use your desktop theme's foreground color for text and labels, blending seamlessly with any theme.")
        );

        let linksGroup = new Adw.PreferencesGroup({
            title: _('Learn More'),
        });
        this.add(linksGroup);

        this._addLinkRow(linksGroup,
            _('Custom Metrics Guide'),
            _('Graph any metric using Prometheus exporters'),
            `${PROJECT_URL}/blob/master/docs/widget-authoring.md#custom-metrics-no-code-changes`
        );

        this._addLinkRow(linksGroup,
            _('Widget Development'),
            _('Create new widget types for the extension'),
            `${PROJECT_URL}/blob/master/docs/widget-authoring.md`
        );

        this._addLinkRow(linksGroup,
            _('Project Homepage'),
            _('Report issues, contribute, or star the project'),
            PROJECT_URL
        );
    }

    _addFeatureRow(group, iconName, title, subtitle) {
        let row = new Adw.ActionRow({
            title: title,
            subtitle: subtitle,
        });
        row.add_prefix(new Gtk.Image({
            icon_name: iconName,
            pixel_size: 24,
            valign: Gtk.Align.CENTER,
        }));
        group.add(row);
    }

    _addLinkRow(group, title, subtitle, uri) {
        let row = new Adw.ActionRow({
            title: title,
            subtitle: subtitle,
            activatable: true,
        });
        row.add_suffix(new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        row.connect('activated', () => {
            Gtk.show_uri(this.get_root(), uri, 0);
        });
        group.add(row);
    }
});

// ** Extension Preferences **
export default class SystemMonitorExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = this.getSettings();

        let generalSettingsPage = new SMGeneralPrefsPage(settings);
        window.add(generalSettingsPage);

        let monitorsPage = new SMMonitorsPage(settings);
        window.add(monitorsPage);

        let whatsNewPage = new SMWhatsNewPage();
        window.add(whatsNewPage);

        window.set_title(_('System Monitor Next Preferences'));
        window.search_enabled = true;
        window.set_default_size(645, 745);
    }
}
