/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { ElementBase } from '../base.js';

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
        this._server = config.server || 'http://localhost:9100';
        this._metric = config.metric || 'up';
        this.cursor = extension._Samplers.prometheus(this._server).cursor();
        this._setLabels();
    }

    collectAsync(callback) {
        this.cursor.sample(reading => {
            if (this._destroyed) {
                callback(null);
                return;
            }
            if (!reading?.data) {
                callback(null);
                return;
            }
            let val = this._parseMetric(reading.data.lines());
            if (val === null) {
                callback(null);
                return;
            }
            callback({metrics: {value: val}, display: this._formatValue(val)});
        });
    }

    _parseMetric(lines) {
        let needle = this._metric;
        let labelFilters = null;
        let braceIdx = needle.indexOf('{');
        if (braceIdx !== -1) {
            let labelStr = needle.substring(braceIdx + 1).replace(/}$/, '');
            needle = this._metric.substring(0, braceIdx);
            labelFilters = labelStr.split(',').map(s => s.trim()).filter(s => s);
        }

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
        if (this.config.server !== newConfig.server) {
            this._server = newConfig.server || 'http://localhost:9100';
            // A cursor is bound to its sampler, and a different server is a
            // different sampler -- keeping the old one would keep scraping the
            // old server.
            this.cursor = this.extension._Samplers.prometheus(this._server).cursor();
        }
        if (this.config.metric !== newConfig.metric) {
            this._metric = newConfig.metric || 'up';
            this._setLabels();
        }
        super.onSettingsChanged(newConfig);
    }

    destroy() {
        // The session and the scrape in flight belong to the sampler now, and
        // are shared with every other widget on this server.
        super.destroy();
    }
};

export { Prometheus };
