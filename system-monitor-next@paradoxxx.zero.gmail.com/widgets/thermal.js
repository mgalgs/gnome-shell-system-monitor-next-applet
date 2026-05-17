/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { sm_log } from '../utils.js';
import { check_sensors } from '../common.js';
import { ElementBase, try_read_int_file } from '../base.js';

const Thermal = class SystemMonitor_Thermal extends ElementBase {
    static metadata = {
        label: 'thrm',
        name: 'Thermal',
        metrics: [{ key: 'tz0', color: true }],
    };

    constructor(extension, config) {
        super(extension, config);
        this.max = 100;
        this.sensor_label = this.device_id;
        this.sensors = check_sensors('temp');
        this._display_error = true;
        this._temperature = null;

        this.item_name = this.sensor_label ? this.sensor_label : _('Thermal');
        this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;

        if (this.sensor_label) {
            let shortLabel = this.sensor_label.split(' - ').pop();
            if (shortLabel.length > 6)
                shortLabel = shortLabel.substring(0, 6);
            this.label.text = shortLabel;
        }

        this.tip_format(this._symbol());
        this.reset_style();
    }

    collectAsync(callback) {
        if (!this.sensors || Object.keys(this.sensors).length === 0) {
            callback(null);
            return;
        }
        let sfile = this.sensors[this.sensor_label];
        if (sfile === undefined) {
            if (this._display_error) {
                const validLabels = Object.keys(this.sensors).join(', ');
                sm_log(`Invalid thermal sensor label: "${this.sensor_label}" (valid choices: ${validLabels})`, 'error');
                this._display_error = false;
            }
            callback(null);
            return;
        }
        if (!try_read_int_file(sfile, value => {
            this._temperature = Math.round(value / 1000);
            this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;
            let display = this._formatTemp();
            callback({tz0: this._temperature, display: display});
        })) {
            if (this._display_error) {
                sm_log(`Error reading thermal sensor file: ${sfile}`, 'error');
                this._display_error = false;
            }
            callback(null);
        }
    }

    format(data) {
        let symbol = this._symbol();
        this.text_items[1].text = symbol;
        this.menu_items[1].text = symbol;
        this.tip_unit_labels[0].text = _(symbol);

        this.temp_over_threshold = this._temperature !== null &&
            this._temperature > (this.config.threshold || 0);
    }

    update() {
        let result = ElementBase.prototype.update.call(this);
        this.threshold();
        return result;
    }

    reset_style() {
        this.text_items[0].set_style('color: rgba(255, 255, 255, 1)');
    }

    threshold() {
        if (this.config.threshold) {
            if (this.temp_over_threshold)
                this.text_items[0].set_style('color: rgba(255, 0, 0, 1)');
            else
                this.text_items[0].set_style('color: rgba(255, 255, 255, 1)');
        }
    }

    _formatTemp() {
        if (this._temperature === null)
            return '-- ';
        let t = this._temperature;
        if (this.fahrenheit_unit)
            t = Math.round(t * 1.8 + 32);
        return t.toString();
    }

    _symbol() {
        return this.fahrenheit_unit ? '°F' : '°C';
    }

    create_text_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-status-value'),
                y_align: Clutter.ActorAlign.CENTER}),
            new St.Label({
                text: this._symbol(),
                style_class: this.extension._Style.get('sm-temp-label'),
                y_align: Clutter.ActorAlign.CENTER}),
        ];
    }

    create_menu_items() {
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: this._symbol(),
                style_class: this.extension._Style.get('sm-label')}),
        ];
    }
}

export { Thermal };
