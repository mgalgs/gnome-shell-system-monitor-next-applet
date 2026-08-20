/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { sm_log } from '../utils.js';
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
        this.cursor = extension._Samplers.gpu.cursor();
        this._missingLogged = false;
        this._mem = 0;
        this._total = 0;
        this._percentage = 0;

        this.item_name = _('GPU') + (this.gpu_index !== '0' ? ' ' + this.gpu_index : '');
        if (this.gpu_index !== '0')
            this.label.text = _('gpu') + this.gpu_index;
    }

    collectAsync(callback) {
        this.cursor.sample(reading => {
            if (this._destroyed) {
                callback(null);
                return;
            }
            const gpu = reading?.data?.get(this.gpu_index);
            if (!gpu) {
                this._reportMissing(reading?.data);
                callback(null);
                return;
            }
            this._missingLogged = false;
            this._scaleUnits(gpu);

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
        });
    }

    // The panel can only say "no reading"; which GPUs the script did report is
    // the difference between a mystery and a one-line diagnosis.
    _reportMissing(gpus) {
        if (this._missingLogged)
            return;
        this._missingLogged = true;
        const script = `${this.extension.path}/gpu_usage.sh`;
        const listed = gpus ? [...gpus.keys()] : [];
        if (listed.length) {
            sm_log(`${this.item_name}: gpu_usage.sh listed GPUs ${listed.join(', ')} — ` +
                   `nothing for ${this.gpu_index}. Showing "--".`, 'warn');
        } else {
            sm_log(`${this.item_name}: gpu_usage.sh listed no GPUs. ` +
                   `Run it by hand to see why: bash ${script}`, 'warn');
        }
    }

    _scaleUnits(gpu) {
        if (typeof this.useGiB === 'undefined')
            this._initUnit(gpu.total);
        this._percentage = gpu.busy;
        if (this.useGiB) {
            this._mem = Math.round(gpu.used / this._unitConversion) / this._decimals;
            this._total = Math.round(gpu.total / this._unitConversion) / this._decimals;
        } else {
            this._mem = Math.round(gpu.used / this._unitConversion);
            this._total = Math.round(gpu.total / this._unitConversion);
        }
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
