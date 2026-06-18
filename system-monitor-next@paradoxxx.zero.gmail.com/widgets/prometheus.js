/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ElementBase } from '../base.js';
import { sm_log } from '../utils.js';

import Soup from 'gi://Soup?version=3.0';

const Prometheus = class SystemMonitor_Prometheus extends ElementBase {
    static metadata = {
        name: 'Prometheus',
        label: 'prom',
        metrics: [{key: 'value', color: true}],
        panelUnit: '',
        menuUnit: '',
        tooltipUnit: '',
    };

    constructor(extension, config) {
        super(extension, config);
        this._session = new Soup.Session({timeout: 10});
        this._cancellable = new Gio.Cancellable();
        this._server = config.server || 'http://localhost:9100';
        this._metric = config.metric || 'up';
        this._setLabels();
    }

    collectAsync(callback) {
        if (!this._session) {
            callback(this._failureData());
            return;
        }

        let uri = this._server + '/metrics';
        let message = Soup.Message.new('GET', uri);
        if (!message) {
            callback(this._failureData());
            return;
        }

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
            try {
                let bytes = session.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK) {
                    callback(this._failureData());
                    return;
                }
                let text = new TextDecoder().decode(bytes.get_data());
                let val = this._parseMetric(text);
                if (val === null) {
                    callback(this._failureData());
                    return;
                }
                this._fetchErrorLogged = false;
                let display = this._formatValue(val);
                callback({metrics: {value: val}, display: display});
            } catch (e) {
                if (!this._fetchErrorLogged &&
                    (!(e instanceof Gio.IOErrorEnum) || e.code !== Gio.IOErrorEnum.CANCELLED)) {
                    sm_log(`Prometheus fetch error: ${e.message}`, 'warn');
                    this._fetchErrorLogged = true;
                }
                callback(this._failureData());
            }
        });
    }

    // No metrics key: a failed scrape must not chart a fake 0
    // (indistinguishable from a real zero reading) -- leave the chart at
    // its last value and signal the failure via the panel text.
    _failureData() {
        return {display: '--'};
    }

    _parseMetric(text) {
        let needle = this._metric;
        let labelFilters = null;
        let braceIdx = needle.indexOf('{');
        if (braceIdx !== -1) {
            let labelStr = needle.substring(braceIdx + 1).replace(/}$/, '');
            needle = this._metric.substring(0, braceIdx);
            labelFilters = labelStr.split(',').map(s => s.trim()).filter(s => s);
        }

        let lines = text.split('\n');
        for (let line of lines) {
            if (line.startsWith('#') || line.length === 0)
                continue;
            let name = line.split(/[{\s]/)[0];
            if (name !== needle)
                continue;
            if (labelFilters) {
                let lineLabels = line.substring(line.indexOf('{'), line.indexOf('}') + 1);
                if (!labelFilters.every(f => lineLabels.includes(f)))
                    continue;
            }
            let parts = line.trimEnd().split(/\s+/);
            let val = parseFloat(parts[1]);
            if (!isNaN(val))
                return val;
        }
        return null;
    }

    _formatValue(val) {
        if (Math.abs(val) >= 1e9)
            return (val / 1e9).toPrecision(3) + 'G';
        if (Math.abs(val) >= 1e6)
            return (val / 1e6).toPrecision(3) + 'M';
        if (Math.abs(val) >= 1e4)
            return (val / 1e3).toPrecision(3) + 'k';
        if (Math.abs(val) >= 10)
            return Math.round(val).toString();
        if (val === 0)
            return '0';
        return val.toPrecision(3);
    }

    _setLabels() {
        let short = this._metric;
        if (short.startsWith('node_'))
            short = short.substring(5);
        if (short.length > 12)
            short = short.substring(0, 12);
        this.label.text = short;
        this.item_name = this._metric;
    }

    onSettingsChanged(newConfig) {
        if (this.config.server !== newConfig.server)
            this._server = newConfig.server || 'http://localhost:9100';
        if (this.config.metric !== newConfig.metric) {
            this._metric = newConfig.metric || 'up';
            this._setLabels();
        }
        super.onSettingsChanged(newConfig);
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        super.destroy();
    }
};

export { Prometheus };
