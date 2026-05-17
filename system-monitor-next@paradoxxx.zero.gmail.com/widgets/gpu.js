/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import St from "gi://St";
import { ElementBase } from '../base.js';

const Gpu = class SystemMonitor_Gpu extends ElementBase {
    static metadata = {
        name: 'GPU',
        metrics: [
            { key: 'used', color: true },
            { key: 'memory', color: true },
        ],
        tooltipUnit: '%',
    };

    constructor(extension, config) {
        super(extension, config);
        this.max = 100;
        this.gpu_index = this.device_id;

        this.item_name = _('GPU') + (this.gpu_index !== '0' ? ' ' + this.gpu_index : '');
        this.mem = 0;
        this.total = 0;

        if (this.gpu_index !== '0') {
            this.label.text = _('GPU') + this.gpu_index;
        }

    }
    _unit(total) {
        this.total = total;
        let threshold = 4 * 1024; // In MiB
        this.useGiB = false;
        this._unitConversion = 1;
        this._decimals = 100;
        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;
        }
    }
    refresh() {
        try {
            let path = this.extension.path;
            let script = ['/usr/bin/env', 'bash', path + '/gpu_usage.sh', this.gpu_index];

            let proc = new Gio.Subprocess({argv: script, flags: Gio.SubprocessFlags.STDOUT_PIPE});
            proc.init(null);
            proc.communicate_utf8_async(null, null, this._handleOutput.bind(this));
        } catch (err) {
            console.error(err.message);
        }
    }
    _handleOutput(proc, result) {
        let [ok, output, ] = proc.communicate_utf8_finish(result);
        if (ok) {
            this._readTemperature(output);
        } else {
            console.error('gpu_usage.sh invocation failed');
        }
    }
    _sanitizeUsageValue(val) {
        val = parseInt(val);
        if (isNaN(val)) {
            val = 0
        }
        return val;
    }
    _readTemperature(procOutput) {
        let usage = procOutput.split('\n');
        let memTotal = this._sanitizeUsageValue(usage[0]);
        let memUsed = this._sanitizeUsageValue(usage[1]);
        this.percentage = this._sanitizeUsageValue(usage[2]);
        if (typeof this.useGiB === 'undefined') {
            this._unit(memTotal);
            this._update_unit();
        }

        if (this.useGiB) {
            this.mem = Math.round(memUsed / this._unitConversion);
            this.mem /= this._decimals;
            this.total = Math.round(memTotal / this._unitConversion);
            this.total /= this._decimals;
        } else {
            this.mem = Math.round(memUsed / this._unitConversion);
            this.total = Math.round(memTotal / this._unitConversion);
        }
    }
    _pad(number) {
        if (this.useGiB) {
            if (number < 1) {
                return number.toFixed(2);
            }
            return number.toPrecision(3);
        }

        return number;
    }
    _update_unit() {
        let unit = _('MiB');
        if (this.useGiB) {
            unit = _('GiB');
        }
        this.menu_items[4].text = unit;
    }
    _apply() {
        const Style = this.extension._Style;
        const Locale = this.extension._Locale;
        this.tip_unit_labels[1].text = "/ " + this.total + " " + this.menu_items[4].text;
        if (this.total === 0) {
            this.vals = [0, 0];
            this.tip_vals = [0, 0];
        } else {
            this.vals = [this.percentage, this.mem / this.total * 100 - this.percentage];
            this.tip_vals = [Math.round(this.vals[0]), this.mem];
        }
        this.text_items[0].text = this.tip_vals[0].toString();
        this.menu_items[0].text = this.tip_vals[0].toLocaleString(Locale);
        if (Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(this.mem).toLocaleString(Locale) +
                '  /  ' + this._pad(this.total).toLocaleString(Locale);
        } else {
            this.menu_items[3].text = this._pad(this.mem).toLocaleString(Locale) +
                '/' + this._pad(this.total).toLocaleString(Locale);
        }
    }
    create_menu_items() {
        const Style = this.extension._Style;
        let unit = _('MiB');
        if (this.useGiB) {
            unit = _('GiB');
        }
        return [
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: '%',
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: Style.get('sm-value')}),
            new St.Label({
                text: unit,
                style_class: Style.get('sm-label')})
        ];
    }
}

export { Gpu };
