/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GTop from "gi://GTop";
import St from "gi://St";
import { ElementBase } from '../base.js';

const Swap = class SystemMonitor_Swap extends ElementBase {
    static metadata = {
        name: 'Swap',
        metrics: [{ key: 'used', color: true }],
        tooltipUnit: '%',
    };

    constructor(extension, config) {
        super(extension, config);
        this.max = 1;
        this.gtop = new GTop.glibtop_swap();

        GTop.glibtop_get_swap(this.gtop);
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
        GTop.glibtop_get_swap(this.gtop);
        if (this.useGiB) {
            this.swap = Math.round(this.gtop.used / this._unitConversion);
            this.swap /= this._decimals;
            this.total = Math.round(this.gtop.total / this._unitConversion);
            this.total /= this._decimals;
        } else {
            this.swap = Math.round(this.gtop.used / this._unitConversion);
            this.total = Math.round(this.gtop.total / this._unitConversion);
        }
    }
    _pad(number) {
        if (this.useGiB) {
            if (number < 1) {
                return number.toLocaleString(this.extension._Locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            }
            return number.toLocaleString(this.extension._Locale, {minimumSignificantDigits: 3, maximumSignificantDigits: 3});
        }

        return number.toLocaleString(this.extension._Locale);
    }
    _apply() {
        if (this.total === 0) {
            this.vals = this.tip_vals = [0];
        } else {
            this.vals[0] = this.swap / this.total;
            this.tip_vals[0] = Math.round(this.vals[0] * 100);
        }
        this.text_items[0].text = this.tip_vals[0].toString();
        this.menu_items[0].text = this.tip_vals[0].toString();
        if (this.extension._Style.get('') !== '-compact') {
            this.menu_items[3].text = this._pad(this.swap) +
                ' / ' + this._pad(this.total);
        } else {
            this.menu_items[3].text = this._pad(this.swap) +
                '/' + this._pad(this.total);
        }
    }

    create_menu_items() {
        let unit = 'MiB';
        if (this.useGiB) {
            unit = 'GiB';
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
            new St.Label({
                text: _(unit),
                style_class: this.extension._Style.get('sm-label')})
        ];
    }
}

export { Swap };
