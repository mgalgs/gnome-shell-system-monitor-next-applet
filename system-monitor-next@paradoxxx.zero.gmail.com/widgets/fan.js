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
        this.sensors = check_sensors("fan");
        this.rpm = 0;
        this.display_error = true;

        this.item_name = this.sensor_label ? this.sensor_label : _('Fan');

        if (this.sensor_label) {
            let shortLabel = this.sensor_label.split(' - ').pop();
            if (shortLabel.length > 6) {
                shortLabel = shortLabel.substring(0, 6);
            }
            this.label.text = shortLabel;
        }

    }
    refresh() {
        if (this.sensors === undefined || Object.keys(this.sensors).length === 0) {
            return;
        }
        let sfile = this.sensors[this.sensor_label];
        if (sfile === undefined && this.display_error) {
            const validLabels = Object.keys(this.sensors).join(', ');
            sm_log(`Invalid fan sensor label: "${this.sensor_label}" (valid choices: ${validLabels})`, 'error');
            this.display_error = false;
            return;
        }
        if (!try_read_int_file(sfile, value => this.rpm = value) && this.display_error) {
            sm_log(`Error reading fan sensor file: ${sfile}`, 'error');
            this.display_error = false;
        }
        if (sfile) {
            try_read_int_file(sfile.replace(/_input$/, '_min'), value => this.min = value);
            try_read_int_file(sfile.replace(/_input$/, '_max'), value => this.max = value);
        }
    }
    _apply() {
        this.text_items[0].text = this.rpm.toString();
        this.menu_items[0].text = this.rpm.toString();
        this.vals = [this.rpm];
        this.tip_vals[0] = this.rpm;
    }
}

export { Fan };
