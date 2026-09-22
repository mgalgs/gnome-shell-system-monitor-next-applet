/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { sm_log } from '../utils.js';
import { check_sensors_async, read_sensor_async } from '../common.js';
import { ElementBase } from '../base.js';

const Thermal = class SystemMonitor_Thermal extends ElementBase {
    static metadata = {
        label: 'thrm',
        name: 'Thermal',
        metrics: [{ key: 'tz0', color: true }],
        panelUnitStyle: 'sm-temp-label',
        panelUnit: '',
    };

    constructor(extension, config) {
        super(extension, config);
        this.max = 100;
        this.sensor_label = this.device_id;
        this.sensors = null;
        check_sensors_async('temp', sensors => {
            this.sensors = sensors;
        });
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
    }

    collectAsync(callback) {
        if (!this.sensors || Object.keys(this.sensors).length === 0) {
            callback(null);
            return;
        }
        let sensorInfo = this.sensors[this.sensor_label];
        if (!sensorInfo) {
            if (this._display_error) {
                const validLabels = Object.keys(this.sensors).join(', ');
                sm_log(`Invalid thermal sensor label: "${this.sensor_label}" (valid choices: ${validLabels})`, 'error');
                this._display_error = false;
            }
            callback(null);
            return;
        }
        read_sensor_async(sensorInfo, value => {
            if (this._destroyed) { callback(null); return; }
            if (value === null) {
                if (this._display_error) {
                    sm_log(`Error reading thermal sensor: "${this.sensor_label}"`, 'error');
                    this._display_error = false;
                }
                callback(null);
                return;
            }
            this._temperature = Math.round(value / 1000);
            this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;
            let symbol = this._symbol();
            callback({
                metrics: {tz0: this._temperature},
                display: this._formatTemp(),
                unit: symbol,
                tipUnits: [_(symbol)],
                alertValue: this._displayTemp(),
            });
        });
    }

    _alertUnit() {
        return this._symbol();
    }

    // Temperature in the unit the panel displays. The threshold is entered in
    // that same unit, so the comparison has to use this rather than the raw
    // Celsius reading.
    _displayTemp() {
        if (this._temperature === null)
            return null;
        if (this.fahrenheit_unit)
            return Math.round(this._temperature * 1.8 + 32);
        return this._temperature;
    }

    _formatTemp() {
        let t = this._displayTemp();
        if (t === null)
            return '-- ';
        return t.toString();
    }

    _symbol() {
        return this.fahrenheit_unit ? '°F' : '°C';
    }

}

export { Thermal };
