/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

'use strict';

import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Adw from "gi://Adw";

import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { check_sensors } from './common.js';

const N_ = function (e) {
    return e;
};

function sm_log(message) {
    console.log(`[system-monitor-next-prefs] ${message}`);
}

String.prototype.capitalize = function () {
    return this.replace(/(^|\s)([a-z])/g, function (m, p1, p2) {
        return p1 + p2.toUpperCase();
    });
};

function color_to_hex(color) {
    var output = N_('#%02x%02x%02x%02x').format(
        Math.round(255 * color.red),
        Math.round(255 * color.green),
        Math.round(255 * color.blue),
        Math.round(255 * color.alpha));
    return output;
}

function loadTemplate(fileName) {
    const file = Gio.File.new_for_uri(import.meta.url);
    const templateFile = file.get_parent().resolve_relative_path(fileName);
    const [, templateBytes] = templateFile.load_contents(null);
    return templateBytes;
}

// Helper functions to get available devices
function getAvailableCpus() {
    let cpus = ['all'];
    try {
        const GTop = imports.gi.GTop;
        let numCores = GTop.glibtop_get_sysinfo().ncpu;
        for (let i = 0; i < numCores; i++) {
            cpus.push(i.toString());
        }
    } catch (e) {
        // Default to 4 cores if we can't detect
        for (let i = 0; i < 4; i++) {
            cpus.push(i.toString());
        }
    }
    return cpus;
}

function getAvailableNetworkInterfaces() {
    let interfaces = ['all'];
    try {
        let file = Gio.file_new_for_path('/proc/net/dev');
        let [success, contents] = file.load_contents(null);
        if (success) {
            let lines = new TextDecoder('utf-8').decode(contents).split('\n');
            for (let i = 2; i < lines.length; i++) {
                let iface = lines[i].trim().split(':')[0];
                if (iface && iface !== 'lo') {
                    interfaces.push(iface);
                }
            }
        }
    } catch (e) {
        console.error('Error getting network interfaces: ' + e);
    }
    return interfaces;
}

function getAvailableDisks() {
    let disks = ['all'];
    try {
        let file = Gio.file_new_for_path('/proc/diskstats');
        let [success, contents] = file.load_contents(null);
        if (success) {
            let lines = new TextDecoder('utf-8').decode(contents).split('\n');
            let seenDisks = new Set();
            for (let line of lines) {
                let parts = line.trim().split(/\s+/);
                if (parts.length > 2) {
                    let disk = parts[2];
                    // Filter to main disk devices
                    if (disk && /^(sd[a-z]|nvme\d+n\d+|mmcblk\d+)$/.test(disk)) {
                        seenDisks.add(disk);
                    }
                }
            }
            disks.push(...Array.from(seenDisks));
        }
    } catch (e) {
        console.error('Error getting disks: ' + e);
    }
    return disks;
}

// ** General Preferences Page **
const SMGeneralPrefsPage = GObject.registerClass({
    GTypeName: 'SMGeneralPrefsPage',
    Template: loadTemplate('ui/prefsGeneralSettings.ui'),
    InternalChildren: ['background', 'icon_display', 'show_tooltip', 'move_clock',
        'compact_display', 'center_display', 'left_display', 'rotate_labels',
        'tooltip_delay_ms', 'graph_delay_m', 'custom_monitor_switch', 'custom_monitor_command'],
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

// ** Widget Preferences Page **
const SMMonitorExpanderRow = GObject.registerClass({
    GTypeName: 'SMMonitorExpanderRow',
    Template: loadTemplate('ui/prefsExpanderRow.ui'),
    InternalChildren: ['display', 'show_menu', 'show_text', 'style', 'graph_width', 'refresh_time'],
    Signals: {
        'updated': { param_types: [GObject.TYPE_OBJECT] },
    },
}, class SMMonitorExpanderRow extends Adw.ExpanderRow {
    constructor(config, params = {}) {
        super(params);

        this._config = config;

        this.title = `${this._config.type.capitalize()} - ${this._config.device}`;

        this._colorDialog = new Gtk.ColorDialog({
            modal: true,
            with_alpha: true,
        });

        this._display.active = this._config.display;
        this._show_menu.active = this._config['show-menu'];
        this._show_text.active = this._config['show-text'];
        this._style.set_selected(this._config.style === 'digit' ? 0 : this._config.style === 'graph' ? 1 : 2);
        this._graph_width.set_value(this._config['graph-width']);
        this._refresh_time.set_value(this._config['refresh-time']);

        this._display.connect('notify::active', () => this._update('display', this._display.active));
        this._show_menu.connect('notify::active', () => this._update('show-menu', this._show_menu.active));
        this._show_text.connect('notify::active', () => this._update('show-text', this._show_text.active));
        this._style.connect('notify::selected', () => this._update('style', ['digit', 'graph', 'both'][this._style.selected]));
        this._graph_width.connect('notify::value', () => this._update('graph-width', this._graph_width.value));
        this._refresh_time.connect('notify::value', () => this._update('refresh-time', this._refresh_time.value));

        this._addColorsItems();
        this._addTypeSpecificItems();
    }

    _update(key, value) {
        this._config[key] = value;
        this.emit('updated', this._config);
    }

    _addColorsItems() {
        if (!this._config.colors) return;
        for (const colorName in this._config.colors) {
            let actionRow = new Adw.ActionRow({ title: colorName.capitalize() });
            let colorItem = new Gtk.ColorDialogButton({ valign: Gtk.Align.CENTER });

            let color = new Gdk.RGBA();
            color.parse(this._config.colors[colorName]);
            colorItem.set_rgba(color);
            colorItem.set_dialog(this._colorDialog);

            colorItem.connect('notify::rgba', (button) => {
                this._config.colors[colorName] = color_to_hex(button.get_rgba());
                this.emit('updated', this._config);
            });

            actionRow.add_suffix(colorItem);
            this.add_row(actionRow);
        }
    }

    _addTypeSpecificItems() {
        switch (this._config.type) {
            case 'thermal': {
                let item = new Adw.SpinRow({
                    title: _('Temperature threshold (0 to disable)'),
                    adjustment: new Gtk.Adjustment({ value: this._config.threshold, lower: 0, upper: 300, step_increment: 5, page_increment: 10 }),
                });
                item.connect('notify::value', () => this._update('threshold', item.value));
                this.add_row(item);

                item = new Adw.SwitchRow({ title: _('Display temperature in Fahrenheit'), active: this._config['fahrenheit-unit'] });
                item.connect('notify::active', () => this._update('fahrenheit-unit', item.active));
                this.add_row(item);
                break;
            }
            case 'net': {
                let item = new Adw.SwitchRow({ title: _('Show network speed in bits'), active: this._config['speed-in-bits'] });
                item.connect('notify::active', () => this._update('speed-in-bits', item.active));
                this.add_row(item);
                break;
            }
            case 'battery': {
                let item = new Adw.SwitchRow({ title: _('Show Time Remaining'), active: this._config.time });
                item.connect('notify::active', () => this._update('time', item.active));
                this.add_row(item);
                break;
            }
            case 'freq': {
                let stringListModel = new Gtk.StringList();
                stringListModel.append(_('Max across all cores'));
                stringListModel.append(_('Average across all cores'));
                let item = new Adw.ComboRow({
                    title: _('Value'),
                    model: stringListModel,
                    selected: this._config['display-mode'] === 'max' ? 0 : 1
                });
                item.connect('notify::selected', () => this._update('display-mode', item.selected === 0 ? 'max' : 'average'));
                this.add_row(item);
                break;
            }
        }
    }
});

const SMMonitorsPage = GObject.registerClass({
    GTypeName: 'SMMonitorsPage',
    Template: loadTemplate('ui/prefsWidgetSettings.ui'),
    InternalChildren: ['widget_prefs_group'],
}, class SMMonitorsPage extends Adw.PreferencesPage {
    constructor(settings, params = {}) {
        super(params);
        this._settings = settings;
        this._monitors = this._loadMonitors();

        this._listBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        this._listBox.add_css_class('boxed-list');
        this._widget_prefs_group.add(this._listBox);

        const addButton = new Gtk.Button({ label: _('Add Monitor...'), halign: Gtk.Align.CENTER, margin_top: 10 });
        addButton.connect('clicked', this._onAddMonitor.bind(this));
        this._widget_prefs_group.add(addButton);

        this._buildList();
    }

    _loadMonitors() {
        return this._settings.get_strv('monitors').map(m => JSON.parse(m));
    }

    _saveMonitors() {
        this._settings.set_strv('monitors', this._monitors.map(m => JSON.stringify(m)));
    }

    _buildList() {
        // Clear list box
        let child = this._listBox.get_first_child();
        while (child) {
            this._listBox.remove(child);
            child = this._listBox.get_first_child();
        }

        // Re-populate
        this._monitors.forEach(monitor => {
            const expander = new SMMonitorExpanderRow(monitor);
            expander.connect('updated', (widget, newConfig) => {
                const index = this._monitors.findIndex(m => m.uuid === newConfig.uuid);
                if (index !== -1) {
                    this._monitors[index] = newConfig;
                    this._saveMonitors();
                }
            });

            const removeButton = new Gtk.Button({ icon_name: 'edit-delete-symbolic', valign: Gtk.Align.CENTER });
            removeButton.add_css_class('flat');
            removeButton.connect('clicked', () => {
                this._monitors = this._monitors.filter(m => m.uuid !== monitor.uuid);
                this._saveMonitors();
                this._buildList();
            });
            expander.add_suffix(removeButton);

            this._listBox.append(expander);
        });
    }

    _onAddMonitor() {
        const dialog = new Gtk.Dialog({
            title: _('Add New Monitor'),
            transient_for: this.get_root(),
            modal: true,
        });
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Add'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, margin_top: 10, margin_bottom: 10, margin_start: 10, margin_end: 10 });
        dialog.get_content_area().append(content);

        const typeModel = new Gtk.StringList();
        const types = ['cpu', 'memory', 'swap', 'net', 'disk', 'gpu', 'thermal', 'fan', 'battery', 'freq'];
        types.forEach(t => typeModel.append(t.capitalize()));
        const typeRow = new Adw.ComboRow({ title: _('Type'), model: typeModel });
        content.append(typeRow);

        const deviceModel = new Gtk.StringList();
        const deviceRow = new Adw.ComboRow({ title: _('Device'), model: deviceModel });
        content.append(deviceRow);

        typeRow.connect('notify::selected', () => {
            const type = types[typeRow.selected];
            deviceModel.remove_all();
            let devices = [];
            switch (type) {
                case 'cpu':
                case 'freq':
                    devices = getAvailableCpus();
                    break;
                case 'net':
                    devices = getAvailableNetworkInterfaces();
                    break;
                case 'disk':
                    devices = getAvailableDisks();
                    break;
                case 'gpu':
                    devices = ['0', '1', '2', '3'];
                    break;
                case 'thermal':
                    devices = Object.keys(check_sensors('temp'));
                    break;
                case 'fan':
                    devices = Object.keys(check_sensors('fan'));
                    break;
                default:
                    devices = ['default'];
            }
            devices.forEach(d => deviceModel.append(d));
            deviceRow.selected = 0;
        });
        typeRow.notify('selected');

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                const type = types[typeRow.selected];
                const device = deviceModel.get_string(deviceRow.selected);
                this._createNewMonitor(type, device);
            }
            dialog.destroy();
        });
        dialog.show();
    }

    _createNewMonitor(type, device) {
        const defaults = {
            uuid: Gio.dbus_generate_guid(),
            type,
            device,
            display: true,
            style: 'graph',
            'graph-width': 100,
            'refresh-time': 2000,
            'show-text': true,
            'show-menu': true,
            colors: {},
        };

        const colorMap = {
            cpu: { user: '#0072b3', system: '#0092e6', nice: '#00a3ff', iowait: '#002f3d', other: '#001d26' },
            memory: { program: '#00b35b', buffer: '#00ff82', cache: '#aaf5d0' },
            swap: { used: '#8b00c3' },
            net: { down: '#fce94f', up: '#fb74fb', downerrors: '#ff6e00', uperrors: '#e0006e', collisions: '#ff0000' },
            disk: { read: '#c65000', write: '#ff6700' },
            gpu: { used: '#00b35b', memory: '#00ff82' },
            thermal: { tz0: '#f2002e' },
            fan: { fan0: '#f2002e' },
            battery: { batt0: '#f2002e' },
            freq: { freq: '#001d26' },
        };
        defaults.colors = colorMap[type] || {};

        if (type === 'thermal') {
            defaults['fahrenheit-unit'] = false;
            defaults.threshold = 0;
        }
        if (type === 'net') defaults['speed-in-bits'] = false;
        if (type === 'battery') defaults.time = false;
        if (type === 'freq') defaults['display-mode'] = 'max';

        this._monitors.push(defaults);
        this._saveMonitors();
        this._buildList();
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

        window.set_title(_('System Monitor Next Preferences'));
        window.search_enabled = true;
        window.set_default_size(645, 745);
    }
}