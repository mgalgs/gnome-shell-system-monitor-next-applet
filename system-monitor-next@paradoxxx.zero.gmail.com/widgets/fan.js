/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { sm_log } from '../utils.js';
import { check_sensors } from '../common.js';
import { ElementBase, try_read_int_file } from '../base.js';

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
        this.sensors = check_sensors('fan');
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
        let sfile = this.sensors[this.sensor_label];
        if (sfile === undefined) {
            if (this._display_error) {
                const validLabels = Object.keys(this.sensors).join(', ');
                sm_log(`Invalid fan sensor label: "${this.sensor_label}" (valid choices: ${validLabels})`, 'error');
                this._display_error = false;
            }
            callback(null);
            return;
        }
        if (!try_read_int_file(sfile, value => {
            this._rpm = value;
            try_read_int_file(sfile.replace(/_input$/, '_min'), v => { this.min = v; });
            try_read_int_file(sfile.replace(/_input$/, '_max'), v => { this.max = v; });
            callback({fan0: this._rpm});
        })) {
            if (this._display_error) {
                sm_log(`Error reading fan sensor file: ${sfile}`, 'error');
                this._display_error = false;
            }
            callback(null);
        }
    }
}

export { Fan };
