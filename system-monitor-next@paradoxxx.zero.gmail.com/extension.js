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

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import GLib from "gi://GLib";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { sm_log } from './utils.js';
import { migrateSettings } from './migration.js';
import { color_from_string, smStyleManager, build_menu_info } from './base.js';
import { smMountsMonitor, Bar, Pie } from './mounts.js';
import { Battery } from './widgets/battery.js';
import { Cpu } from './widgets/cpu.js';
import { Disk } from './widgets/disk.js';
import { Fan } from './widgets/fan.js';
import { Freq } from './widgets/frequency.js';
import { Gpu } from './widgets/gpu.js';
import { Icon } from './widgets/icon.js';
import { Mem } from './widgets/memory.js';
import { Net } from './widgets/network.js';
import { Swap } from './widgets/swap.js';
import { Thermal } from './widgets/thermal.js';
import { Prometheus } from './widgets/prometheus.js';

const PANEL_ICON_SIZE = 16;

const WIDGET_CLASSES = {
    cpu: Cpu,
    memory: Mem,
    swap: Swap,
    net: Net,
    disk: Disk,
    gpu: Gpu,
    thermal: Thermal,
    fan: Fan,
    battery: Battery,
    freq: Freq,
    prometheus: Prometheus,
};

function parseMonitorConfigs(strv) {
    let configs = [];
    for (const s of strv) {
        try {
            let c = JSON.parse(s);
            if (c && c.uuid && c.type)
                configs.push(c);
        } catch (e) {
            sm_log(`Skipping malformed monitor config: ${e.message}`, 'warn');
        }
    }
    return configs;
}

function change_usage(extension) {
    let usage = extension._Schema.get_string('disk-usage-style');
    extension.__sm.pie.show(usage === 'pie');
    extension.__sm.bar.show(usage === 'bar');
}

export default class SystemMonitorExtension extends Extension {
    _lookupMonitorApp() {
        const monitorAppIds = [
            'org.gnome.SystemMonitor.desktop',
            'gnome-system-monitor.desktop',
            'net.nokyan.Resources.desktop',
        ];
        let _appSys = Shell.AppSystem.get_default();
        for (const id of monitorAppIds) {
            let app = _appSys.lookup_app(id);
            if (app)
                return app;
        }
        return null;
    }

    openSystemMonitor() {
        let _gsmApp = this._lookupMonitorApp();
        let customCmd = this._Schema.get_string('custom-monitor-command');

        if (!customCmd || customCmd.trim() === '') {
            if (_gsmApp)
                _gsmApp.activate();
            else
                sm_log('No system monitor application found', 'warn');
            return;
        }

        sm_log("Executing custom system monitor command: " + customCmd);
        try {
            let [success, argv] = GLib.shell_parse_argv(customCmd);
            if (!success) {
                sm_log('Failed to parse custom monitor command: ' + customCmd, 'error');
                if (_gsmApp)
                    _gsmApp.activate();
                return;
            }

            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.NONE
            });
            proc.init(null);
            proc.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                    sm_log('Custom system monitor command completed with exit code: ' + proc.get_exit_status());
                } catch (e) {
                    sm_log('Error waiting for process completion: ' + e.message, 'error');
                }
            });
        } catch (e) {
            sm_log('Failed to execute custom monitor command: ' + e.message, 'error');
            if (_gsmApp)
                _gsmApp.activate();
        }
    }

    // One malformed entry in the user-editable monitors key must not take
    // down the whole extension (or abort a sync mid-way), so widget
    // construction failures are contained here and the entry skipped.
    _createWidget(config) {
        const WidgetClass = WIDGET_CLASSES[config.type];
        if (!WidgetClass) {
            sm_log(`Skipping monitor ${config.uuid}: unknown type "${config.type}"`, 'warn');
            return null;
        }
        try {
            const widget = new WidgetClass(this, config);
            widget._activateTimers();
            return widget;
        } catch (e) {
            sm_log(`Skipping monitor ${config.uuid} (${config.type}): ${e}`, 'error');
            return null;
        }
    }

    _syncMonitors() {
        const newConfigs = parseMonitorConfigs(this._Schema.get_strv('monitors'));
        const oldUUIDs = new Set(this.__sm.elts.map(elt => elt.config.uuid));
        const newUUIDs = new Set(newConfigs.map(c => c.uuid));

        // Remove widgets no longer in config
        const removedUUIDs = [...oldUUIDs].filter(uuid => !newUUIDs.has(uuid));
        for (const uuid of removedUUIDs) {
            const widget = this.__sm.widgetMap.get(uuid);
            if (widget) {
                sm_log(`Removing monitor ${uuid}`);
                widget.destroy();
                this.__sm.widgetMap.delete(uuid);
            }
        }

        // Update existing widgets and add new ones
        const newEltArray = [];
        for (const config of newConfigs) {
            let widget = this.__sm.widgetMap.get(config.uuid);

            if (widget) {
                try {
                    widget.onSettingsChanged(config);
                } catch (e) {
                    sm_log(`Monitor ${config.uuid} (${config.type}) failed to apply new settings: ${e}`, 'error');
                }
                newEltArray.push(widget);
            } else {
                sm_log(`Adding new monitor ${config.uuid} (${config.type})`);
                const newWidget = this._createWidget(config);
                if (newWidget) {
                    this.__sm.widgetMap.set(config.uuid, newWidget);
                    newEltArray.push(newWidget);
                }
            }
        }

        // Re-order widgets in panel
        this.__sm.elts = newEltArray;
        this._box.remove_all_children();
        this._box.add_child(this.__sm.icon.actor);
        for (const widget of this.__sm.elts) {
            this._box.add_child(widget.actor);
            widget.actor.visible = widget.config.display;
        }

        build_menu_info(this);
    }

    enable() {
        sm_log('applet enable from ' + this.path);

        this._Schema = this.getSettings();
        try {
            migrateSettings(this);
        } catch (e) {
            sm_log(`Settings migration failed: ${e.message}`, 'error');
        }

        // Get locale, needed as an argument for toLocaleString() since GNOME Shell 3.24
        this._Locale = GLib.get_language_names()[0];
        if (this._Locale.indexOf('_') !== -1) {
            this._Locale = this._Locale.split('_')[0];
        }

        try {
            new Date().toLocaleString(this._Locale);
        } catch (e) {
            sm_log('fallback to EN: ' + e.message, 'warn')
            this._Locale = 'en'
        }

        this._IconSize = Math.round(PANEL_ICON_SIZE * 4 / 5);

        this._Style = new smStyleManager(this);
        this._MountsMonitor = new smMountsMonitor(this);

        this._Background = color_from_string(this._Schema.get_string('background'));

        this.menuTimeout = null;
        this._settingsConnection = null;

        let panel = Main.panel._rightBox;
        if (this._Schema.get_boolean('center-display')) {
            panel = Main.panel._centerBox;
        }
        else if (this._Schema.get_boolean('left-display')) {
            panel = Main.panel._leftBox;
        }

        this._MountsMonitor.startListening();

        this.__sm = {
            tray: new PanelMenu.Button(0.5),
            icon: new Icon(this),
            pie: new Pie(this),
            bar: new Bar(this),
            elts: [],
            widgetMap: new Map(),
        };
        let tray = this.__sm.tray;

        if (this._Schema.get_boolean('move-clock')) {
            let dateMenu = Main.panel.statusArea.dateMenu;
            Main.panel._centerBox.remove_child(dateMenu.container);
            Main.panel._addToPanelBox('dateMenu', dateMenu, -1, Main.panel._rightBox);
            tray.clockMoved = true;
        }

        Main.panel._addToPanelBox('system-monitor', tray, 1, panel);

        let spacing = this._Schema.get_boolean('compact-display') ? '1' : '4';
        this._box = new St.BoxLayout({style: 'spacing: ' + spacing + 'px;'});
        tray.add_child(this._box);
        this._box.add_child(this.__sm.icon.actor);

        // Create widgets from monitors config
        const monitorConfigs = parseMonitorConfigs(this._Schema.get_strv('monitors'));
        for (const config of monitorConfigs) {
            const widget = this._createWidget(config);
            if (widget) {
                this.__sm.elts.push(widget);
                this.__sm.widgetMap.set(config.uuid, widget);
                this._box.add_child(widget.actor);
            }
        }

        this._Schema.connectObject(
            'changed::background', (schema, key) => {
                this._Background = color_from_string(this._Schema.get_string(key));
            },
            'changed::monitors', () => this._syncMonitors(),
            'changed::disk-usage-style', () => change_usage(this),
            this
        );

        // Build Menu Info Box Table
        let menu_info = new PopupMenu.PopupBaseMenuItem({reactive: false});
        let menu_info_box = new St.BoxLayout();
        menu_info.actor.add_child(menu_info_box);
        this.__sm.tray.menu.addMenuItem(menu_info, 0);

        build_menu_info(this);

        tray.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let pie_item = this.__sm.pie;
        pie_item.create_menu_item();
        tray.menu.addMenuItem(pie_item.menu_item);

        let bar_item = this.__sm.bar;
        bar_item.create_menu_item();
        tray.menu.addMenuItem(bar_item.menu_item);

        change_usage(this);

        tray.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        tray.menu.connectObject(
            'open-state-changed',
            (menu, isOpen) => {
                if (isOpen) {
                    this.__sm.pie.actor.queue_repaint();

                    this.menuTimeout = GLib.timeout_add_seconds(
                        GLib.PRIORITY_DEFAULT,
                        5,
                        () => {
                            if (!this.__sm) return GLib.SOURCE_REMOVE;
                            this.__sm.pie.actor.queue_repaint();
                            return GLib.SOURCE_CONTINUE;
                        });
                } else {
                    GLib.Source.remove(this.menuTimeout);
                }
            },
            this
        );

        let item;
        let customCmd = this._Schema.get_string('custom-monitor-command');
        if (this._lookupMonitorApp() || (customCmd && customCmd.trim() !== '')) {
            item = new PopupMenu.PopupMenuItem(_('System Monitor...'));
            item.connect('activate', () => {
                this.openSystemMonitor();
            });
            tray.menu.addMenuItem(item);
        }

        item = new PopupMenu.PopupMenuItem(_('Preferences...'));
        item.connect('activate', () => {
            this.openPreferences();
        });
        tray.menu.addMenuItem(item);
        Main.panel.menuManager.addMenu(tray.menu);
    }

    disable() {
        if (this.menuTimeout) {
            GLib.Source.remove(this.menuTimeout);
            this.menuTimeout = null;
        }
        this._Schema.disconnectObject(this);
        // restore clock
        if (this.__sm.tray.clockMoved) {
            let dateMenu = Main.panel.statusArea.dateMenu;
            Main.panel._rightBox.remove_child(dateMenu.container);
            Main.panel._addToPanelBox('dateMenu', dateMenu, Main.sessionMode.panel.center.indexOf('dateMenu'), Main.panel._centerBox);
        }

        this.__sm.tray.menu.disconnectObject(this);
        for (let elt of this.__sm.widgetMap.values()) {
            elt.destroy();
        }
        this.__sm.pie.destroy();
        this.__sm.bar.destroy();
        this.__sm.icon.destroy();
        this._box.destroy();
        this._box = null;
        this.__sm.tray.destroy();
        this.__sm.tray = null;
        this.__sm = null;

        if (this._MountsMonitor) {
            this._MountsMonitor.stopListening();
            this._MountsMonitor = null;
        }

        if (this._Style) {
            this._Style = null;
        }

        this._Schema = null;

        sm_log('applet disable');
    }
}
