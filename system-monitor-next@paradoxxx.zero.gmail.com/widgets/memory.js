/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import GTop from "gi://GTop";
import { ElementBase } from '../base.js';

const Mem = class SystemMonitor_Mem extends ElementBase {
    static metadata = {
        label: 'mem',
        name: 'Memory',
        metrics: [
            { key: 'program', color: true },
            { key: 'buffer', color: true },
            { key: 'cache', color: true },
        ],
        menuLayout: 'detail',
        tooltipUnit: '%',
    };

    constructor(extension, config) {
        super(extension, config);
        this.max = 1;

        this.gtop = new GTop.glibtop_mem();

        GTop.glibtop_get_mem(this.gtop);
        this.total = Math.round(this.gtop.total / 1024 / 1024);
        let threshold = 4 * 1024; // In MiB
        this.useGiB = false;
        this._unitConversion = 1024 * 1024;
        this._decimals = 100;
        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;
        }

    }
    collect() {
        GTop.glibtop_get_mem(this.gtop);
        let mem = [0, 0, 0];
        let total;
        if (this.useGiB) {
            mem[0] = Math.round(this.gtop.user / this._unitConversion) / this._decimals;
            mem[1] = Math.round(this.gtop.buffer / this._unitConversion) / this._decimals;
            mem[2] = Math.round(this.gtop.cached / this._unitConversion) / this._decimals;
            total = Math.round(this.gtop.total / this._unitConversion) / this._decimals;
        } else {
            mem[0] = Math.round(this.gtop.user / this._unitConversion);
            mem[1] = Math.round(this.gtop.buffer / this._unitConversion);
            mem[2] = Math.round(this.gtop.cached / this._unitConversion);
            total = Math.round(this.gtop.total / this._unitConversion);
        }

        if (total === 0) {
            return {metrics: {program: 0, buffer: 0, cache: 0}, display: '0',
                detail: '', detailUnit: this._unitStr(),
                tipVals: [0, 0, 0]};
        }

        let programRatio = mem[0] / total;
        let bufferRatio = mem[1] / total;
        let cacheRatio = mem[2] / total;
        let percent = Math.round(programRatio * 100);
        let compact = this.extension._Style.get('') === '-compact';
        let sep = compact ? '/' : ' / ';

        return {
            metrics: {
                program: programRatio,
                buffer: bufferRatio,
                cache: cacheRatio,
            },
            display: percent.toLocaleString(this.extension._Locale),
            detail: this._pad(mem[0]) + sep + this._pad(total),
            detailUnit: this._unitStr(),
            tipVals: [
                Math.round(programRatio * 100),
                Math.round(bufferRatio * 100),
                Math.round(cacheRatio * 100),
            ],
        };
    }

    _unitStr() {
        return this.useGiB ? 'GiB' : 'MiB';
    }

    _pad(number) {
        const Locale = this.extension._Locale;
        if (this.useGiB) {
            if (number < 1)
                return number.toLocaleString(Locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            return number.toLocaleString(Locale, {minimumSignificantDigits: 3, maximumSignificantDigits: 3});
        }
        return number.toLocaleString(Locale);
    }
}

export { Mem };
