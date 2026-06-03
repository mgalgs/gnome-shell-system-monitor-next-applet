/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import { ElementBase } from '../base.js';

const Gpu = class SystemMonitor_Gpu extends ElementBase {
    static metadata = {
        name: 'GPU',
        metrics: [
            { key: 'used', color: true },
            { key: 'memory', color: true },
        ],
        menuLayout: 'detail',
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
            this.label.text = _('gpu') + this.gpu_index;
    }

    collectAsync(callback) {
        try {
            let path = this.extension.path;
            let script = ['/usr/bin/env', 'bash', path + '/gpu_usage.sh', this.gpu_index];
            let proc = new Gio.Subprocess({argv: script, flags: Gio.SubprocessFlags.STDOUT_PIPE});
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, result) => {
                if (this._destroyed) {
                    callback(null);
                    return;
                }
                let [ok, output] = p.communicate_utf8_finish(result);
                if (!ok) {
                    callback(null);
                    return;
                }
                this._parseOutput(output);
                if (this._total === 0) {
                    callback({metrics: {used: 0, memory: 0}, display: '0',
                        detail: '', detailUnit: this._unitStr()});
                } else {
                    const Locale = this.extension._Locale;
                    let memPct = this._mem / this._total * 100 - this._percentage;
                    let compact = this.extension._Style.get('') === '-compact';
                    let sep = compact ? '/' : '  /  ';
                    let unitStr = this._unitStr();
                    callback({
                        metrics: {
                            used: this._percentage,
                            memory: memPct,
                        },
                        display: Math.round(this._percentage).toLocaleString(Locale),
                        detail: this._pad(this._mem).toLocaleString(Locale) +
                            sep + this._pad(this._total).toLocaleString(Locale),
                        detailUnit: unitStr,
                        tipVals: [this._percentage, this._mem],
                        tipUnits: ['%', '/ ' + this._total + ' ' + unitStr],
                    });
                }
            });
        } catch (err) {
            console.error(err.message);
            callback(null);
        }
    }

    _parseOutput(procOutput) {
        let usage = procOutput.split('\n');
        let memTotal = this._parseInt(usage[0]);
        let memUsed = this._parseInt(usage[1]);
        this._percentage = this._parseInt(usage[2]);
        if (typeof this.useGiB === 'undefined')
            this._initUnit(memTotal);
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

    _unitStr() {
        return this.useGiB ? 'GiB' : 'MiB';
    }

    _pad(number) {
        if (this.useGiB) {
            if (number < 1)
                return number.toFixed(2);
            return number.toPrecision(3);
        }
        return number;
    }
}

export { Gpu };
