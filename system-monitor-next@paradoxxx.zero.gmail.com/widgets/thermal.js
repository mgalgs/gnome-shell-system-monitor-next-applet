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

        this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;
        this._syncSensorNames();

        this.tip_format(this._symbol());
        this.reset_style();
    }

    _sensorLabels() {
        const selected = Array.isArray(this.config['sensor-labels']) ? this.config['sensor-labels'] : [];
        return [...new Set([this.sensor_label, ...selected])].filter(label => label);
    }

    _syncSensorNames() {
        const multiple = this._sensorLabels().length > 1;
        this.item_name = multiple ? _('Maximum Temperature') : this.sensor_label || _('Thermal');
        this.label.text = multiple ? _('max') : this.sensor_label
            ? this.sensor_label.split(' - ').pop().substring(0, 6) : _('thrm');
    }

    onSettingsChanged(config) {
        super.onSettingsChanged(config);
        this._syncSensorNames();
    }

    collectAsync(callback) {
        if (!this.sensors || Object.keys(this.sensors).length === 0) {
            callback(null);
            return;
        }
        const labels = this._sensorLabels();
        const missing = labels.filter(label => !this.sensors[label]);
        if (labels.length === 0 || missing.length > 0) {
            if (this._display_error) {
                const validLabels = Object.keys(this.sensors).join(', ');
                sm_log(`Invalid thermal sensor labels: "${missing.join(', ')}" (valid choices: ${validLabels})`, 'error');
                this._display_error = false;
            }
            callback({display: '--', unit: this._symbol()});
            return;
        }

        let remaining = labels.length;
        const readings = [];
        let finished = false;
        const finish = result => {
            if (finished)
                return;
            finished = true;
            callback(result);
        };
        const onReading = value => {
            if (finished)
                return;
            if (this._destroyed) {
                finish(null);
                return;
            }
            readings.push(value);
            if (--remaining > 0)
                return;
            if (readings.some(reading => reading === null)) {
                finish({display: '--', unit: this._symbol()});
                return;
            }
            this._temperature = Math.round(Math.max(...readings) / 1000);
            this.fahrenheit_unit = this.config['fahrenheit-unit'] || false;
            const symbol = this._symbol();
            this.temp_over_threshold = this._temperature > (this.config.threshold || 0);
            this.threshold();
            finish({
                metrics: {tz0: this._temperature},
                display: this._formatTemp(),
                unit: symbol,
                tipUnits: [_(symbol)],
            });
        };
        for (const label of labels)
            read_sensor_async(this.sensors[label], onReading);
    }

    reset_style() {
        this.text_items[0].set_style(null);
    }

    threshold() {
        if (this.config.threshold) {
            if (this.temp_over_threshold)
                this.text_items[0].set_style('color: rgba(255, 0, 0, 1)');
            else
                this.text_items[0].set_style(null);
        } else {
            this.text_items[0].set_style(null);
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

}

export { Thermal };
