/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import St from "gi://St";
import UPowerGlib from "gi://UPowerGlib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { sm_log } from '../utils.js';
import { ElementBase, build_menu_info } from '../base.js';

const UPower = UPowerGlib;

const Battery = class SystemMonitor_Battery extends ElementBase {
    constructor(extension) {
        super(extension, {
            elt: 'battery',
            elt_short: 'batt',
            item_name: _('Battery'),
            color_name: ['batt0'],
            icon: '. GThemedIcon battery-good-symbolic battery-good'
        });

        this.max = 100;
        this.icon_hidden = false;
        this.percentage = 0;
        this.timeString = '-- ';

        // Battery updates are event driven, and require the following _proxy value to exist.
        //   this._proxy = Main.panel.statusArea.quickSettings._system._systemItem._powerToggle._proxy;
        // This does not exist at launch time, so start a GLib handler to poll for it
        this._poll_attempts = 0;
        this._max_poll_attempts = 9;
        this._poll_handler_id = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 1, this._poll_quickSettings.bind(this)
        );

        // need to specify a default icon, since the contructor completes before UPower callback
        this.gicon = Gio.icon_new_for_string(this.icon);

        this.tip_format('%');

        this.update_tips();
        // this.hide_system_icon();

        // Schema.connect('changed::' + this.elt + '-hidesystem', this.hide_system_icon.bind(this));
        extension._Schema.connect('changed::' + this.elt + '-time', this.update_tips.bind(this));
    }
    refresh() {
        // do nothing here?
    }
    _poll_quickSettings() {
        // check if the quickSettings proxy value is defined
        // once it is, set this._proxy and remove the handler

        if (this._proxy) {
            return GLib.SOURCE_REMOVE;
        }

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
                // set this._proxy, bind update_battery(), and stop polling
                sm_log("Battery proxy found!");
                this._proxy = proxy;
                this.powerSigID = this._proxy.connect(
                    'g-properties-changed',
                    this.update_battery.bind(this),
                );
                this._poll_handler_id = undefined;
                this._poll_attempts = 0;
                return GLib.SOURCE_REMOVE;
            }
        } catch (error) {
            sm_log(`Error accessing quickSettings proxy: ${error.message}`, 'warn');
        }

        // Check if we've exceeded maximum attempts
        this._poll_attempts++;
        if (this._poll_attempts >= this._max_poll_attempts) {
            sm_log(`Battery proxy not found after ${this._poll_attempts}, giving up`);
            this._poll_handler_id = undefined;
            return GLib.SOURCE_REMOVE;
        }

        // Exponential backoff
        const next_delay = Math.pow(2, this._poll_attempts - 1);
        this._poll_handler_id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, next_delay, this._poll_quickSettings.bind(this));
        return GLib.SOURCE_REMOVE;
    }
    update_battery() {
        // callback function for when battery stats updated.
        let battery_found = false;
        let isBattery = false;
        if (typeof (this._proxy.GetDevicesRemote) === 'undefined') {
            let device_type = this._proxy.Type;
            isBattery = (device_type === UPower.DeviceKind.BATTERY);
            if (isBattery) {
                battery_found = true;
                let icon = this._proxy.IconName;
                let percentage = this._proxy.Percentage;
                let seconds = this._proxy.TimeToEmpty;
                this.update_battery_value(seconds, percentage, icon);
            } else {
                // log("[System monitor] No battery found");
                this.actor.hide();
                this.menu_visible = false;
                build_menu_info(this.extension);
            }
        } else {
            this._proxy.GetDevicesRemote((devices, error) => {
                if (error) {
                    sm_log('Power proxy error: ' + error, 'error');
                    this.actor.hide();
                    this.menu_visible = false;
                    build_menu_info(this.extension);
                    return;
                }

                let [result] = devices;
                for (let i = 0; i < result.length; i++) {
                    let [device_id, device_type, icon, percentage, state, seconds] = result[i];

                    isBattery = (device_type === UPower.DeviceKind.BATTERY);
                    if (isBattery) {
                        battery_found = true;
                        this.update_battery_value(seconds, percentage, icon);
                        break;
                    }
                }

                if (!battery_found) {
                    // log("[System monitor] No battery found");
                    this.actor.hide();
                    this.menu_visible = false;
                    build_menu_info(this.extension);
                }
            });
        }
    }
    update_battery_value(seconds, percentage, icon) {
        if (seconds > 60) {
            let time = Math.round(seconds / 60);
            let minutes = time % 60;
            let hours = Math.floor(time / 60);
            this.timeString = C_('battery time remaining', '%d:%02d').format(hours, minutes);
        } else {
            this.timeString = '-- ';
        }
        this.percentage = Math.ceil(percentage);
        this.gicon = Gio.icon_new_for_string(icon);

        if (this.extension._Schema.get_boolean(this.elt + '-display')) {
            this.actor.show()
        }
        if (this.extension._Schema.get_boolean(this.elt + '-show-menu') && !this.menu_visible) {
            this.menu_visible = true;
            build_menu_info(this.extension);
        }
    }
    hide_system_icon(override) {
        let value = this.extension._Schema.get_boolean(this.elt + '-hidesystem');
        if (!override) {
            value = false;
        }
        if (value && this.extension._Schema.get_boolean(this.elt + '-display')) {
            const StatusArea = Main.panel.statusArea;
            if (StatusArea.battery.actor.visible) {
                StatusArea.battery.destroy();
                this.icon_hidden = true;
            }
        } else if (this.icon_hidden) {
            // TODO: Figure out what to put here instead
            // (git blame for more info)
            // let Indicator = new Panel.PANEL_ITEM_IMPLEMENTATIONS.battery();
            // Main.panel.addToStatusArea('battery', Indicator, Main.sessionMode.panel.right.indexOf('battery'), 'right');
            this.icon_hidden = false;
            // Main.panel._updatePanel('right');
        }
    }
    get_battery_unit() {
        let unitString;
        let value = this.extension._Schema.get_boolean(this.elt + '-time');

        if (value) {
            unitString = 'h';
        } else {
            unitString = '%';
        }

        return unitString;
    }
    update_tips() {
        let unitString = this.get_battery_unit();

        if (this.extension._Schema.get_boolean(this.elt + '-display')) {
            this.text_items[2].text = unitString;
        }
        if (this.extension._Schema.get_boolean(this.elt + '-show-menu')) {
            this.menu_items[1].text = unitString;
        }

        this.update();
    }
    _apply() {
        let displayString;
        let value = this.extension._Schema.get_boolean(this.elt + '-time');
        if (value) {
            displayString = this.timeString;
        } else {
            displayString = this.percentage.toString()
        }
        if (this.extension._Schema.get_boolean(this.elt + '-display')) {
            this.text_items[0].gicon = this.gicon;
            this.text_items[1].text = displayString;
        }
        if (this.extension._Schema.get_boolean(this.elt + '-show-menu')) {
            this.menu_items[0].text = displayString;
        }
        this.vals = [this.percentage];
        this.tip_vals[0] = Math.round(this.percentage);
    }
    create_text_items() {
        return [
            new St.Icon({
                gicon: Gio.icon_new_for_string(this.icon),
                style_class: this.extension._Style.get('sm-status-icon')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: this.get_battery_unit(),
                style_class: this.extension._Style.get('sm-perc-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: this.get_battery_unit(),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
    destroy() {
        ElementBase.prototype.destroy.call(this);

        if (this._proxy) {
            this._proxy.disconnect(this.powerSigID);
        }

        if (this._poll_handler_id) {
            GLib.source_remove(this._poll_handler_id);
            this._poll_handler_id = undefined;
        }
    }
}

export { Battery };
