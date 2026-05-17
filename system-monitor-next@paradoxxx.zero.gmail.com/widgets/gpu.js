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
        this._mem = 0;
        this._total = 0;
        this._percentage = 0;

        this.item_name = _('GPU') + (this.gpu_index !== '0' ? ' ' + this.gpu_index : '');
        if (this.gpu_index !== '0')
            this.label.text = _('GPU') + this.gpu_index;
    }

    collectAsync(callback) {
        try {
            let path = this.extension.path;
            let script = ['/usr/bin/env', 'bash', path + '/gpu_usage.sh', this.gpu_index];
            let proc = new Gio.Subprocess({argv: script, flags: Gio.SubprocessFlags.STDOUT_PIPE});
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, result) => {
                let [ok, output] = p.communicate_utf8_finish(result);
                if (!ok) {
                    callback(null);
                    return;
                }
                this._parseOutput(output);
                if (this._total === 0) {
                    callback({used: 0, memory: 0, display: '0',
                        _mem: 0, _total: 0});
                } else {
                    let memPct = this._mem / this._total * 100 - this._percentage;
                    callback({
                        used: this._percentage,
                        memory: memPct,
                        display: Math.round(this._percentage).toString(),
                        _mem: this._mem,
                        _total: this._total,
                    });
                }
            });
        } catch (err) {
            console.error(err.message);
            callback(null);
        }
    }

    format(data) {
        const Style = this.extension._Style;
        const Locale = this.extension._Locale;
        this.tip_unit_labels[1].text = '/ ' + data._total + ' ' + this.menu_items[4].text;
        this.tip_vals[1] = data._mem;
        this.menu_items[0].text = data.display.toLocaleString
            ? Math.round(data.used).toLocaleString(Locale)
            : data.display;
        let compact = Style.get('') === '-compact';
        let sep = compact ? '/' : '  /  ';
        this.menu_items[3].text = this._pad(data._mem).toLocaleString(Locale) +
            sep + this._pad(data._total).toLocaleString(Locale);
    }

    _parseOutput(procOutput) {
        let usage = procOutput.split('\n');
        let memTotal = this._parseInt(usage[0]);
        let memUsed = this._parseInt(usage[1]);
        this._percentage = this._parseInt(usage[2]);
        if (typeof this.useGiB === 'undefined') {
            this._initUnit(memTotal);
            this._updateUnit();
        }
        if (this.useGiB) {
            this._mem = Math.round(memUsed / this._unitConversion) / this._decimals;
            this._total = Math.round(memTotal / this._unitConversion) / this._decimals;
        } else {
            this._mem = Math.round(memUsed / this._unitConversion);
            this._total = Math.round(memTotal / this._unitConversion);
        }
    }

    _parseInt(val) {
        val = parseInt(val);
        return isNaN(val) ? 0 : val;
    }

    _initUnit(total) {
        this._total = total;
        this.useGiB = total > 4 * 1024;
        this._unitConversion = 1;
        this._decimals = 100;
        if (this.useGiB)
            this._unitConversion *= 1024 / this._decimals;
    }

    _updateUnit() {
        this.menu_items[4].text = this.useGiB ? _('GiB') : _('MiB');
    }

    _pad(number) {
        if (this.useGiB) {
            if (number < 1)
                return number.toFixed(2);
            return number.toPrecision(3);
        }
        return number;
    }

    create_menu_items() {
        const Style = this.extension._Style;
        let unit = this.useGiB ? _('GiB') : _('MiB');
        return [
            new St.Label({text: '', style_class: Style.get('sm-value')}),
            new St.Label({text: '%', style_class: Style.get('sm-label')}),
            new St.Label({text: '', style_class: Style.get('sm-label')}),
            new St.Label({text: '', style_class: Style.get('sm-value')}),
            new St.Label({text: unit, style_class: Style.get('sm-label')}),
        ];
    }
}

export { Gpu };
