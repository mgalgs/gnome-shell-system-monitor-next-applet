/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { sm_log } from '../utils.js';
import { check_sensors_async, read_sensor_async } from '../common.js';
import { ElementBase } from '../base.js';

const Fan = class SystemMonitor_Fan extends ElementBase {
    static metadata = {
        name: 'Fan',
        metrics: [{ key: 'fan0', color: true }],
        panelUnit: 'rpm',
        tooltipUnit: 'rpm',
    };

    constructor(extension, config) {
        super(extension, config);
        this.sensor_label = this.device_id;
        this.sensors = null;
        check_sensors_async('fan', sensors => {
            this.sensors = sensors;
        });
        this._display_error = true;
        this._rpm = 0;

        this.item_name = this.sensor_label ? this.sensor_label : _('Fan');

        if (this.sensor_label) {
            let shortLabel = this.sensor_label.split(' - ').pop();
            if (shortLabel.length > 6)
                shortLabel = shortLabel.substring(0, 6);
            this.label.text = shortLabel;
        }
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
                sm_log(`Invalid fan sensor label: "${this.sensor_label}" (valid choices: ${validLabels})`, 'error');
                this._display_error = false;
            }
            callback(null);
            return;
        }
        read_sensor_async(sensorInfo, value => {
            if (this._destroyed) { callback(null); return; }
            if (value === null) {
                if (this._display_error) {
                    sm_log(`Error reading fan sensor: "${this.sensor_label}"`, 'error');
                    this._display_error = false;
                }
                callback(null);
                return;
            }
            this._rpm = value;
            callback({metrics: {fan0: this._rpm}});
        });
    }
}

export { Fan };
