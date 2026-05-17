/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { sm_log } from '../utils.js';
import { check_sensors } from '../common.js';
import { ElementBase, try_read_int_file } from '../base.js';

const Thermal = class SystemMonitor_Thermal extends ElementBase {
    static metadata = {
        id: 'thermal',
        label: 'thrm',
        name: 'Thermal',
        metrics: [{ key: 'tz0', color: true }],
    };

    constructor(extension, config) {
        super(extension, config);
        this.max = 100;
        this.sensor_label = this.device_id;
        this.sensors = check_sensors("temp");

        this.item_name = this.sensor_label ? this.sensor_label : _('Thermal');
        this.temperature = '-- ';
        this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;
        this.display_error = true;

        if (this.sensor_label) {
            let shortLabel = this.sensor_label.split(' - ').pop();
            if (shortLabel.length > 6) {
                shortLabel = shortLabel.substring(0, 6);
            }
            this.label.text = shortLabel;
        }

        this.tip_format(this.temperature_symbol());
        this.update();
    }
    refresh() {
        if (this.sensors === undefined || Object.keys(this.sensors).length === 0) {
            return;
        }
        let sfile = this.sensors[this.sensor_label];
        if (sfile === undefined && this.display_error) {
            const validLabels = Object.keys(this.sensors).join(', ');
            sm_log(`Invalid thermal sensor label: "${this.sensor_label}" (valid choices: ${validLabels})`, 'error');
            this.display_error = false;
            return;
        }
        if (!try_read_int_file(sfile, value => this.temperature = Math.round(value / 1000)) && this.display_error) {
            sm_log(`Error reading thermal sensor file: ${sfile}`, 'error');
            this.display_error = false;
        }

        this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;
    }
    _apply() {
        this.text_items[0].text = this.menu_items[0].text = this.temperature_text();

        if (typeof this.temperature === 'number') {
            this.temp_over_threshold = this.temperature > (this.config.threshold || 0);
            this.vals = [this.temperature];
        } else {
            this.temp_over_threshold = false;
            this.vals = [0];
        }

        this.tip_vals[0] = this.temperature_text();
        this.text_items[1].text = this.menu_items[1].text = this.temperature_symbol();
        this.tip_unit_labels[0].text = _(this.temperature_symbol());
    }
    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: this.temperature_symbol(),
                style_class: this.extension._Style.get('sm-temp-label'),
                y_align: Clutter.ActorAlign.CENTER})
        ];
    }
    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: this.temperature_symbol(),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
    temperature_text() {
        let temperature = this.temperature;
        if (typeof temperature !== 'number')
            return temperature.toString();

        if (this.fahrenheit_unit) {
            temperature = Math.round(temperature * 1.8 + 32);
        }
        return temperature.toString();
    }
    temperature_symbol() {
        return this.fahrenheit_unit ? '°F' : '°C';
    }
}

export { Thermal };
