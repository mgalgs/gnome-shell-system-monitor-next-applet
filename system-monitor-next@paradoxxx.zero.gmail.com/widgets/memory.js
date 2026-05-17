/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GTop from "gi://GTop";
import St from "gi://St";
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
            return { program: 0, buffer: 0, cache: 0, display: '0', _mem: mem, _total: total };
        }

        let programRatio = mem[0] / total;
        let bufferRatio = mem[1] / total;
        let cacheRatio = mem[2] / total;
        let percent = Math.round(programRatio * 100);

        return {
            program: programRatio,
            buffer: bufferRatio,
            cache: cacheRatio,
            display: percent.toString(),
            _mem: mem,
            _total: total,
        };
    }
    format(data) {
        this.tip_vals[0] = Math.round(data.program * 100);
        this.tip_vals[1] = Math.round(data.buffer * 100);
        this.tip_vals[2] = Math.round(data.cache * 100);

        this.menu_items[0].text = this.tip_vals[0].toLocaleString(this.extension._Locale);

        if (this.extension._Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(data._mem[0]) +
                ' / ' + this._pad(data._total);
        } else {
            this.menu_items[3].text = this._pad(data._mem[0]) +
                '/' + this._pad(data._total);
        }
    }
    _pad(number) {
        const Locale = this.extension._Locale;
        if (this.useGiB) {
            if (number < 1) {
                return number.toLocaleString(Locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            return number.toLocaleString(Locale, {minimumSignificantDigits: 3, maximumSignificantDigits: 3});
        }

        return number.toLocaleString(Locale);
    }
    create_menu_items() {
        let unit = _('MiB');
        if (this.useGiB) {
            unit = _('GiB');
        }
        return [
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({
                text: '%',
                style_class: this.extension._Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-label')}),
            new St.Label({
                text: '',
                style_class: this.extension._Style.get('sm-value')}),
            new St.Label({text: unit,
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

export { Mem };
