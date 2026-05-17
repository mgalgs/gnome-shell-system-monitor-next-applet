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
        this.mem = [0, 0, 0];

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
    refresh() {
        GTop.glibtop_get_mem(this.gtop);
        if (this.useGiB) {
            this.mem[0] = Math.round(this.gtop.user / this._unitConversion);
            this.mem[0] /= this._decimals;
            this.mem[1] = Math.round(this.gtop.buffer / this._unitConversion);
            this.mem[1] /= this._decimals;
            this.mem[2] = Math.round(this.gtop.cached / this._unitConversion);
            this.mem[2] /= this._decimals;
            this.total = Math.round(this.gtop.total / this._unitConversion);
            this.total /= this._decimals;
        } else {
            this.mem[0] = Math.round(this.gtop.user / this._unitConversion);
            this.mem[1] = Math.round(this.gtop.buffer / this._unitConversion);
            this.mem[2] = Math.round(this.gtop.cached / this._unitConversion);
            this.total = Math.round(this.gtop.total / this._unitConversion);
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
    _apply() {
        if (this.total === 0) {
            this.vals = this.tip_vals = [0, 0, 0];
        } else {
            for (let i = 0; i < 3; i++) {
                this.vals[i] = this.mem[i] / this.total;
                this.tip_vals[i] = Math.round(this.vals[i] * 100);
            }
        }
        this.text_items[0].text = this.tip_vals[0].toString();
        this.menu_items[0].text = this.tip_vals[0].toLocaleString(this.extension._Locale);
        if (this.extension._Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(this.mem[0]) +
                ' / ' + this._pad(this.total);
        } else {
            this.menu_items[3].text = this._pad(this.mem[0]) +
                '/' + this._pad(this.total);
        }
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
