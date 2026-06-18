/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _, pgettext as C_ } from "resource:///org/gnome/shell/extensions/extension.js";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import UPowerGlib from "gi://UPowerGlib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { sm_log } from '../utils.js';
import { ElementBase, build_menu_info } from '../base.js';

const UPower = UPowerGlib;

const DEFAULT_BATTERY_ICON = '. GThemedIcon battery-good-symbolic battery-good';

const Battery = class SystemMonitor_Battery extends ElementBase {
    static metadata = {
        name: 'Battery',
        metrics: [{ key: 'batt0', color: true }],
        panelLayout: 'icon',
        panelIcon: DEFAULT_BATTERY_ICON,
    };

    constructor(extension, config) {
        super(extension, config);

        this.max = 100;
        this.icon_hidden = false;
        this._percentage = 0;
        this._timeString = '-- ';
        this._gicon = Gio.icon_new_for_string(DEFAULT_BATTERY_ICON);

        this._poll_attempts = 0;
        this._max_poll_attempts = 9;
        this._poll_handler_id = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 1, this._poll_quickSettings.bind(this)
        );

        this.tip_format('%');
    }

    collect() {
        let showTime = this.config.time || false;
        let displayString = showTime ? this._timeString : this._percentage.toString();
        let unitString = showTime ? 'h' : '%';
        return {
            metrics: {batt0: this._percentage},
            display: displayString,
            icon: this._gicon,
            unit: unitString,
        };
    }

    _poll_quickSettings() {
        if (this._destroyed || this._proxy)
            return GLib.SOURCE_REMOVE;

        try {
            const proxy = (
                Main.panel
                ?.statusArea
                ?.quickSettings
                ?._system
                ?._systemItem
                ?._powerToggle
                ?._proxy
            );

            sm_log(`Looking for battery proxy (attempt ${this._poll_attempts})`);
            if (proxy) {
                sm_log('Battery proxy found!');
                this._proxy = proxy;
                this._proxy.connectObject(
                    'g-properties-changed',
                    this._onBatteryChanged.bind(this),
                    this
                );
                this._onBatteryChanged();
                this._poll_handler_id = undefined;
                this._poll_attempts = 0;
                return GLib.SOURCE_REMOVE;
            }
        } catch (error) {
            sm_log(`Error accessing quickSettings proxy: ${error.message}`, 'warn');
        }

        this._poll_attempts++;
        if (this._poll_attempts >= this._max_poll_attempts) {
            sm_log(`Battery proxy not found after ${this._poll_attempts}, giving up`);
            this._poll_handler_id = undefined;
            return GLib.SOURCE_REMOVE;
        }

        const next_delay = Math.pow(2, this._poll_attempts - 1);
        this._poll_handler_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, next_delay, this._poll_quickSettings.bind(this));
        return GLib.SOURCE_REMOVE;
    }

    _onBatteryChanged() {
        let battery_found = false;
        if (typeof this._proxy.GetDevicesRemote === 'undefined') {
            if (this._proxy.Type === UPower.DeviceKind.BATTERY) {
                battery_found = true;
                this._updateValues(this._proxy.TimeToEmpty, this._proxy.Percentage, this._proxy.IconName);
            }
        } else {
            this._proxy.GetDevicesRemote((devices, error) => {
                if (this._destroyed)
                    return;
                if (error) {
                    sm_log('Power proxy error: ' + error, 'error');
                    this._hideBattery();
                    return;
                }
                let [result] = devices;
                for (let i = 0; i < result.length; i++) {
                    let [_device_id, device_type, icon, percentage, _state, seconds] = result[i];
                    if (device_type === UPower.DeviceKind.BATTERY) {
                        battery_found = true;
                        this._updateValues(seconds, percentage, icon);
                        break;
                    }
                }
                if (!battery_found)
                    this._hideBattery();
            });
            return;
        }
        if (!battery_found)
            this._hideBattery();
    }

    _updateValues(seconds, percentage, icon) {
        if (seconds > 60) {
            let time = Math.round(seconds / 60);
            let minutes = time % 60;
            let hours = Math.floor(time / 60);
            this._timeString = C_('battery time remaining', '%d:%02d').format(hours, minutes);
        } else {
            this._timeString = '-- ';
        }
        this._percentage = Math.ceil(percentage);
        this._gicon = Gio.icon_new_for_string(icon);

        if (this.config.display)
            this.actor.show();
        if (this.config['show-menu'] && !this.menu_visible) {
            this.menu_visible = true;
            build_menu_info(this.extension);
        }
    }

    _hideBattery() {
        this.actor.hide();
        this.menu_visible = false;
        build_menu_info(this.extension);
    }

    hide_system_icon(override) {
        let value = (this.config.hidesystem || false) && override !== false;
        if (value && this.config.display) {
            const StatusArea = Main.panel.statusArea;
            if (StatusArea.battery?.actor?.visible) {
                StatusArea.battery.destroy();
                this.icon_hidden = true;
            }
        } else if (this.icon_hidden) {
            this.icon_hidden = false;
        }
    }

    destroy() {
        if (this._proxy) {
            this._proxy.disconnectObject(this);
            this._proxy = null;
        }
        if (this._poll_handler_id) {
            GLib.source_remove(this._poll_handler_id);
            this._poll_handler_id = undefined;
        }
        ElementBase.prototype.destroy.call(this);
    }
}

export { Battery };
