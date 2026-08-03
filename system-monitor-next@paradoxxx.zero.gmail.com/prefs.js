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
import { parseMonitorConfigs } from './monitors.js';

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

// The widget classes carry proper names in their metadata, but importing them
// here would pull St and the rest of the shell into the preferences process.
const TYPE_NAMES = {
    cpu: 'CPU',
    memory: 'Memory',
    swap: 'Swap',
    net: 'Net',
    disk: 'Disk',
    gpu: 'GPU',
    thermal: 'Thermal',
    fan: 'Fan',
    battery: 'Battery',
    freq: 'Frequency',
    prometheus: 'Prometheus',
};

function type_name(type) {
    return TYPE_NAMES[type] || capitalize(type);
}

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

function gpuName(index) {
    return _('GPU %d').replace('%d', index.toString());
}

// Enumerate by running the script the panel reads, so a GPU the picker offers
// is a GPU the panel can show. Counting DRM cards here instead used to disagree
// with the script on any hybrid-graphics machine -- an Intel card0 with no vram
// counters and an AMD card1 with them yielded two entries that both resolved to
// the AMD.
function getGpuDevices(extensionPath) {
    try {
        if (extensionPath) {
            let [success, stdout] = GLib.spawn_command_line_sync(
                `/usr/bin/env bash ${extensionPath}/gpu_usage.sh`);
            if (success) {
                const ids = new TextDecoder().decode(stdout).split('\n')
                    .map(line => line.trim().split(/\s+/))
                    .filter(field => field.length >= 4 && !isNaN(parseInt(field[1])))
                    .map(field => field[0]);
                if (ids.length)
                    return ids.map(id => ({id, name: gpuName(parseInt(id))}));
            }
        }
    } catch {
        // fall through -- the script may be missing or unreadable
    }
    // Detection can fail here while gpu_usage.sh still works on the shell side,
    // so keep the entry rather than locking those users out -- but say that it
    // was not found instead of presenting it as a GPU we saw.
    return [{id: '0', name: `${gpuName(0)} ${_('(not detected)')}`}];
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

// A type's device axis is one of two shapes, and which one is a fact about what
// the widget measures. An aggregate is a fold over the members ("all cores");
// a member is one element; a singleton is neither, which is why it is its own
// variant rather than an aggregate over an empty set -- there is nothing to
// choose, so there is no picker.
//
// An aggregate may carry a `note`, which replaces the picker's default
// subtitle. Only net needs one: every other aggregate really is a plain total
// over the members listed under it, and net's is not.
function catalogSet(aggregate, members) {
    return {kind: 'set', aggregate, members};
}

function catalogSingleton() {
    return {kind: 'singleton', device: {id: 'default', name: _('Default')}};
}

function named(ids) {
    return ids.map(id => ({id, name: id}));
}

function detectCatalog(type, extensionPath) {
    switch (type) {
    case 'cpu':
    case 'freq':
        return catalogSet(
            {id: 'all', name: _('All cores (total)')},
            getCpuCores().map((id, i) => ({id, name: _('Core %d').replace('%d', (i + 1).toString())})));
    case 'net':
        return catalogSet({
            id: 'all',
            name: _('All physical interfaces (total)'),
            note: _('Excludes VPN, bridge and container interfaces — their traffic is already counted on the hardware carrying it'),
        }, named(getNetInterfaces()));
    case 'disk':
        return catalogSet({id: 'all', name: _('All disks (total)')}, named(getDiskDevices()));
    case 'gpu':
        return catalogSet(null, getGpuDevices(extensionPath));
    case 'thermal':
        return catalogSet(null, named(detectSensors('temp')));
    case 'fan':
        return catalogSet(null, named(detectSensors('fan')));
    default:
        return catalogSingleton();
    }
}

// Sixteen graphs at the standing 100px default is 1600px of panel, so the
// zero-thought path would run off the screen and leave the user to work out
// which knob fixes it. One device still gives exactly 100.
function defaultGraphWidth(deviceCount) {
    return Math.min(100, Math.max(20, Math.round(320 / deviceCount)));
}

function buildDefaultConfig(type, deviceIds) {
    let config = {
        uuid: GLib.uuid_string_random(),
        type: type,
        // A device's label is on when it is the only one and off otherwise:
        // "CPU1 CPU2 CPU3..." across the panel is nobody's goal at sixteen
        // cores, and position already says which is which.
        devices: deviceIds.map(id => ({id, 'show-text': deviceIds.length === 1})),
        display: true,
        style: 'graph',
        'graph-width': defaultGraphWidth(deviceIds.length),
        'refresh-time': type === 'cpu' || type === 'freq' ? 1500 : 5000,
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

// ** Device Selection **

// Both hosts of the picker -- the Add dialog and the row's Devices dialog -- say
// the same thing, because they are the same picker. It has to be a function: an
// extension's gettext resolves which extension is asking from the call stack, so
// calling it while the module is still being imported throws "gettext can only be
// called from extensions".
function devicePickerHint() {
    return _('Tick a device to monitor it. The check on the right shows that device\'s text label in the panel.');
}

function setTriState(check, values) {
    const on = values.filter(Boolean).length;
    check.inconsistent = on > 0 && on < values.length;
    check.active = values.length > 0 && on === values.length;
}

// Owns which devices a monitor watches and whether each shows its panel label.
// Builds rows rather than being a widget itself, so the Add dialog can put them
// in a preferences group and the monitor row can put them in its expander.
class SMDeviceSelection {
    constructor(catalog, entries, onChanged) {
        this._catalog = catalog;
        this._onChanged = onChanged;
        this._updating = false;
        this._rows = [];
        this._widgets = new Map();
        this._state = new Map();

        const configured = new Map(entries.map(e => [e.id, e['show-text'] === true]));

        this._devices = [];
        if (catalog.kind === 'singleton') {
            this._devices.push(catalog.device);
        } else {
            if (catalog.aggregate)
                this._devices.push({...catalog.aggregate, aggregate: true});
            this._devices.push(...catalog.members);
        }

        // A configured device this machine cannot currently see -- a sensor that
        // vanished, a core on a machine that now has fewer -- has to survive the
        // round trip, or opening preferences would delete it on the next save.
        const known = new Set(this._devices.map(d => d.id));
        for (const id of configured.keys()) {
            if (!known.has(id))
                this._devices.push({id, name: `${id} ${_('(not detected)')}`});
        }

        for (const device of this._devices) {
            this._state.set(device.id, {
                selected: catalog.kind === 'singleton' || configured.has(device.id),
                showText: configured.get(device.id) === true,
            });
        }

        this._build();
    }

    get rows() {
        return this._rows;
    }

    get soleDeviceId() {
        return this._devices.length > 0 ? this._devices[0].id : null;
    }

    get entries() {
        return this._devices
            .filter(d => this._state.get(d.id).selected)
            .map(d => ({id: d.id, 'show-text': this._state.get(d.id).showText}));
    }

    get selectedNames() {
        return this._devices
            .filter(d => this._state.get(d.id).selected)
            .map(d => d.name);
    }

    get deviceCount() {
        return this._devices.length;
    }

    getShowText(id) {
        return this._state.get(id)?.showText === true;
    }

    setShowText(id, value) {
        const state = this._state.get(id);
        if (!state || state.showText === value)
            return;
        state.showText = value;
        this._onChanged();
    }

    _selectedIds() {
        return this._devices.map(d => d.id).filter(id => this._state.get(id).selected);
    }

    _build() {
        if (this._catalog.kind === 'singleton' || this._devices.length === 0)
            return;

        // Structurally identical to the rows it governs -- same prefix control,
        // same suffix column -- so what it does needs no explaining. Both halves
        // are actions rather than stored defaults: nothing in the config records
        // a "bulk setting", so there is no default-versus-override question.
        const bulk = new Adw.ActionRow({
            title: this._catalog.aggregate ? _('All individual devices') : _('All devices'),
        });
        this._bulkSelect = new Gtk.CheckButton({valign: Gtk.Align.CENTER});
        this._bulkSelect.connect('toggled', () => this._onBulkSelect());
        bulk.add_prefix(this._bulkSelect);
        this._bulkShowText = new Gtk.CheckButton({label: _('Show text'), valign: Gtk.Align.CENTER});
        this._bulkShowText.connect('toggled', () => this._onBulkShowText());
        bulk.add_suffix(this._bulkShowText);
        this._rows.push(bulk);

        for (const device of this._devices) {
            const row = new Adw.ActionRow({title: device.name});
            if (device.aggregate)
                row.subtitle = device.note || _('Combined figure for every device');

            const select = new Gtk.CheckButton({valign: Gtk.Align.CENTER});
            select.connect('toggled', () => this._onSelect(device.id, select.active));
            row.add_prefix(select);
            row.activatable_widget = select;

            const showText = new Gtk.CheckButton({
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Show this device\'s text label in the panel'),
            });
            showText.connect('toggled', () => this._onShowText(device.id, showText.active));
            row.add_suffix(showText);

            this._widgets.set(device.id, {select, showText});
            this._rows.push(row);
        }

        this._refresh();
    }

    _onSelect(id, active) {
        if (this._updating)
            return;
        // The last selected device cannot be unticked: a monitor over zero
        // devices does nothing, and the extension would drop it on load.
        if (!active && this._selectedIds().length === 1) {
            this._refresh();
            return;
        }
        const state = this._state.get(id);
        state.selected = active;
        if (active)
            state.showText = this._selectedIds().length === 1;
        this._refresh();
        this._onChanged();
    }

    _onShowText(id, active) {
        if (this._updating)
            return;
        this._state.get(id).showText = active;
        this._refresh();
        this._onChanged();
    }

    // Select governs the individual devices only. An aggregate is the sum over
    // all of them, so sweeping it in alongside every core would add a redundant
    // widget that looks like the others and is not.
    _onBulkSelect() {
        if (this._updating)
            return;
        const target = this._bulkSelect.active;
        const members = this._devices.filter(d => !d.aggregate);
        const added = [];
        for (const device of members) {
            const state = this._state.get(device.id);
            if (state.selected === target)
                continue;
            state.selected = target;
            if (target)
                added.push(device.id);
        }
        if (this._selectedIds().length === 0 && members.length > 0) {
            this._state.get(members[0].id).selected = true;
            added.push(members[0].id);
        }
        const only = this._selectedIds().length === 1;
        for (const id of added)
            this._state.get(id).showText = only;
        this._refresh();
        this._onChanged();
    }

    // Show text has no such trap, so it governs every selected device.
    _onBulkShowText() {
        if (this._updating)
            return;
        const target = this._bulkShowText.active;
        for (const id of this._selectedIds())
            this._state.get(id).showText = target;
        this._refresh();
        this._onChanged();
    }

    _refresh() {
        this._updating = true;
        const selected = this._selectedIds();
        for (const device of this._devices) {
            const state = this._state.get(device.id);
            const widgets = this._widgets.get(device.id);
            if (!widgets)
                continue;
            widgets.select.active = state.selected;
            widgets.select.sensitive = !(state.selected && selected.length === 1);
            widgets.showText.active = state.showText;
            widgets.showText.sensitive = state.selected;
        }
        if (this._bulkSelect) {
            const members = this._devices.filter(d => !d.aggregate);
            setTriState(this._bulkSelect, members.map(d => this._state.get(d.id).selected));
            setTriState(this._bulkShowText, selected.map(id => this._state.get(id).showText));
        }
        this._updating = false;
    }
}

// ** Monitor Row **

const SMMonitorRow = GObject.registerClass({
    GTypeName: 'SMMonitorRow',
    Signals: {
        'config-changed': {},
        'delete-requested': {},
    },
}, class SMMonitorRow extends Adw.ExpanderRow {
    constructor(config, extensionPath, params = {}) {
        super(params);

        this._config = config;
        this._colorDialog = new Gtk.ColorDialog({modal: true, with_alpha: true});
        this._dragX = 0;
        this._dragY = 0;
        this._extensionPath = extensionPath;
        this._catalog = detectCatalog(config.type, extensionPath);
        // An entry inherits any key it does not carry from the shared body, so a
        // config still holding show-text there (hand-authored, or written before
        // the device-set migration) must show its real value in the picker.
        const inherited = config['show-text'] === true;
        this._selection = new SMDeviceSelection(
            this._catalog,
            (config.devices || []).map(e => ({...e, 'show-text': e['show-text'] ?? inherited})),
            () => this._onSelectionChanged());

        this.title = type_name(config.type);
        this.subtitle = this._deviceSummary();

        let dragHandle = new Gtk.Image({
            icon_name: 'list-drag-handle-symbolic',
            css_classes: ['drag-handle'],
            valign: Gtk.Align.CENTER,
        });
        this.add_prefix(dragHandle);

        // GTK throws on an undefined property value where the extension just
        // reads it as falsy, so a hand-authored config missing a field would
        // take down the whole preferences window rather than one row. Coerce
        // to what the extension itself makes of the same value.
        let displaySwitch = new Gtk.Switch({
            active: config.display === true,
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

    // The names, not a bare count: "5 devices" makes the user expand the row to
    // find out which five.
    _deviceSummary() {
        if (this._catalog.kind === 'singleton')
            return '';
        const names = this._selection.selectedNames;
        const shown = names.slice(0, 3);
        const rest = names.length - shown.length;
        if (rest > 0)
            return `${shown.join(', ')} + ${_('%d more').replace('%d', rest.toString())}`;
        return shown.join(', ');
    }

    _onSelectionChanged() {
        this._config.devices = this._selection.entries;
        // Every entry now states its own label, so a shared show-text would only
        // be a second, ignored answer to the same question.
        delete this._config['show-text'];
        this.subtitle = this._deviceSummary();
        if (this._devicesRow)
            this._devicesRow.subtitle = this._deviceCount();
        this._emitChanged();
    }

    _deviceCount() {
        const total = this._selection.deviceCount;
        const chosen = this._selection.entries.length;
        // The total beside the count: "did I get them all?" is the question this
        // row exists to answer without opening anything.
        return _('%d of %d selected').replace('%d', chosen.toString()).replace('%d', total.toString());
    }

    // Choosing devices is a pick-then-done task, and the rarest reason to open
    // this row -- creating a monitor picks them in the Add dialog, and everything
    // else here is a setting you nudge. So it gets an entry point rather than the
    // top third of the row, and the list gets a window of its own instead of
    // scrolling inside a row inside a page.
    _openDevicePicker() {
        const dialog = new Adw.Window({
            modal: true,
            title: _('Devices'),
            default_width: 460,
            default_height: 620,
            transient_for: this.get_root(),
        });

        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(new Adw.HeaderBar());
        dialog.set_content(toolbar);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12, margin_bottom: 12,
            margin_start: 12, margin_end: 12,
        });
        toolbar.set_content(box);

        const group = new Adw.PreferencesGroup({description: devicePickerHint()});
        const rows = this._selection.rows;
        for (const row of rows)
            group.add(row);
        box.append(new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
            child: group,
        }));

        // Changes apply immediately here as everywhere else on this page -- a
        // ticked device appears in the panel at once -- so there is nothing to
        // cancel, only a way out.
        const buttons = new Gtk.Box({halign: Gtk.Align.END});
        const close = new Gtk.Button({label: _('Close'), css_classes: ['suggested-action']});
        close.connect('clicked', () => dialog.close());
        buttons.append(close);
        box.append(buttons);

        // The selection outlives the dialog, so hand its rows back before the
        // group is destroyed or they could not be shown a second time.
        dialog.connect('close-request', () => {
            for (const row of rows)
                group.remove(row);
            return false;
        });

        dialog.present();
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

        if (this._catalog.kind !== 'singleton') {
            this._devicesRow = new Adw.ActionRow({
                title: _('Devices'),
                subtitle: this._deviceCount(),
                activatable: true,
            });
            this._devicesRow.add_suffix(new Gtk.Image({
                icon_name: 'go-next-symbolic',
                valign: Gtk.Align.CENTER,
            }));
            this._devicesRow.connect('activated', () => this._openDevicePicker());
            this.add_row(this._devicesRow);
        }

        let showMenu = new Adw.SwitchRow({title: _('Show In Menu'), active: c['show-menu'] === true});
        showMenu.connect('notify::active', w => { c['show-menu'] = w.active; this._emitChanged(); });
        this.add_row(showMenu);

        // Every device gets a Show Text control; only its placement varies. With
        // a picker it rides on the device's row, and a singleton type has no
        // picker -- so it keeps the standalone switch it has always had.
        if (this._catalog.kind === 'singleton') {
            const id = this._selection.soleDeviceId;
            let showText = new Adw.SwitchRow({
                title: _('Show Text'),
                active: this._selection.getShowText(id),
            });
            showText.connect('notify::active', w => this._selection.setShowText(id, w.active));
            this.add_row(showText);
        }

        let styleModel = new Gtk.StringList();
        STYLE_OPTIONS.forEach(s => styleModel.append(_(s)));
        let styleRow = new Adw.ComboRow({
            title: _('Display Style'),
            model: styleModel,
            selected: Math.max(0, STYLE_OPTIONS.indexOf(c.style)),
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
                value: Number(c['graph-width']) || 100, lower: 1, upper: 1000,
                step_increment: 1, page_increment: 10,
            }),
        });
        graphWidth.value = Number(c['graph-width']) || 100;
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
                // 1000 matches l_limit() in base.js, which is what the extension
                // falls back to for a missing or nonsensical interval.
                value: Number(c['refresh-time']) || 1000, lower: 100, upper: 100000,
                step_increment: 500, page_increment: 5000,
            }),
        });
        refreshTime.value = Number(c['refresh-time']) || 1000;
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
    constructor(settings, extensionPath, params = {}) {
        super({
            title: _('Monitors'),
            icon_name: 'utilities-system-monitor-symbolic',
            ...params,
        });

        this._settings = settings;
        this._extensionPath = extensionPath;
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
        // Same parser the extension uses, so preferences and the panel agree on
        // what a valid config is and on how a legacy one normalizes.
        this._monitors = parseMonitorConfigs(this._settings.get_strv('monitors'));
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
        let row = new SMMonitorRow(config, this._extensionPath);
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
            default_width: 460,
            default_height: 560,
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
        MONITOR_TYPES.forEach(t => typeModel.append(_(type_name(t))));
        let typeRow = new Adw.ComboRow({title: _('Type'), model: typeModel});
        group.add(typeRow);

        let serverRow = new Adw.EntryRow({title: _('Exporter URL'), text: 'http://localhost:9100'});
        group.add(serverRow);
        let metricRow = new Adw.EntryRow({title: _('Metric (e.g. node_load1 or metric{label="val"})'), text: 'node_load1'});
        group.add(metricRow);

        let deviceGroup = new Adw.PreferencesGroup({
            title: _('Devices'),
            description: devicePickerHint(),
        });
        let scroller = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
            child: deviceGroup,
        });
        box.append(scroller);

        let selection = null;
        let deviceRows = [];
        let addBtn; // created below with the button box
        const updateTypeUI = () => {
            let type = MONITOR_TYPES[typeRow.selected];
            let isPrometheus = type === 'prometheus';
            serverRow.visible = isPrometheus;
            metricRow.visible = isPrometheus;

            for (const row of deviceRows)
                deviceGroup.remove(row);
            deviceRows = [];

            const catalog = detectCatalog(type, this._extensionPath);
            // A singleton type has nothing to choose; the first device is
            // pre-ticked so the zero-thought path lands on today's behavior.
            const initial = catalog.kind === 'singleton'
                ? [catalog.device]
                : catalog.aggregate ? [catalog.aggregate] : catalog.members.slice(0, 1);
            selection = new SMDeviceSelection(
                catalog, initial.map(d => ({id: d.id, 'show-text': true})),
                () => { addBtn.sensitive = selection.entries.length > 0; });

            deviceRows = selection.rows;
            for (const row of deviceRows)
                deviceGroup.add(row);
            scroller.visible = deviceRows.length > 0;

            // E.g. thermal/fan on a machine with no readable sensors; a monitor
            // saved without a real device could never resolve, so block the add.
            const haveDevices = catalog.kind === 'singleton' || deviceRows.length > 0;
            deviceGroup.description = haveDevices ? devicePickerHint() : _('No devices detected');
            addBtn.sensitive = haveDevices && selection.entries.length > 0;
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
            let entries = selection.entries;
            let config = buildDefaultConfig(type, entries.map(e => e.id));
            // buildDefaultConfig applies the label default for the count; the
            // picker may already have been told otherwise.
            config.devices = entries;
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

        let monitorsPage = new SMMonitorsPage(settings, this.path);
        window.add(monitorsPage);

        let whatsNewPage = new SMWhatsNewPage();
        window.add(whatsNewPage);

        window.set_title(_('System Monitor Next Preferences'));
        window.search_enabled = true;
        window.set_default_size(645, 745);
    }
}
