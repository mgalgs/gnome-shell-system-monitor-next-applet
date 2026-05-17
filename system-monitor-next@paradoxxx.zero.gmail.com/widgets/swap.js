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
        let threshold = 4 * 1024;
        this.useGiB = false;
        this._unitConversion = 1024 * 1024;
        this._decimals = 100;
        if (this.total > threshold) {
            this.useGiB = true;
            this._unitConversion *= 1024 / this._decimals;
        }
    }

    collect() {
        GTop.glibtop_get_swap(this.gtop);
        let swap, total;
        if (this.useGiB) {
            swap = Math.round(this.gtop.used / this._unitConversion) / this._decimals;
            total = Math.round(this.gtop.total / this._unitConversion) / this._decimals;
        } else {
            swap = Math.round(this.gtop.used / this._unitConversion);
            total = Math.round(this.gtop.total / this._unitConversion);
        }
        if (total === 0)
            return { used: 0, display: '0', _swap: 0, _total: 0 };
        let ratio = swap / total;
        let percent = Math.round(ratio * 100);
        return { used: ratio, display: percent.toString(), _swap: swap, _total: total };
    }

    format(data) {
        let compact = this.extension._Style.get('') === '-compact';
        let sep = compact ? '/' : ' / ';
        this.menu_items[3].text = this._pad(data._swap) + sep + this._pad(data._total);
    }

    _pad(number) {
        if (this.useGiB) {
            if (number < 1)
                return number.toLocaleString(this.extension._Locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            return number.toLocaleString(this.extension._Locale, {minimumSignificantDigits: 3, maximumSignificantDigits: 3});
        }
        return number.toLocaleString(this.extension._Locale);
    }

    create_menu_items() {
        let unit = this.useGiB ? 'GiB' : 'MiB';
        return [
            new St.Label({text: '', style_class: this.extension._Style.get('sm-value')}),
            new St.Label({text: '%', style_class: this.extension._Style.get('sm-label')}),
            new St.Label({text: '', style_class: this.extension._Style.get('sm-label')}),
            new St.Label({text: '', style_class: this.extension._Style.get('sm-value')}),
            new St.Label({text: _(unit), style_class: this.extension._Style.get('sm-label')}),
        ];
    }
}

export { Swap };
