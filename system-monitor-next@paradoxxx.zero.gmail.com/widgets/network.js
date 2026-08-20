/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { sm_log } from '../utils.js';
import { ElementBase } from '../base.js';

// The five counters, in the order this widget's metrics and tooltip already use.
const FIELDS = ['bytes_in', 'errors_in', 'bytes_out', 'errors_out', 'collisions'];

const Net = class SystemMonitor_Net extends ElementBase {
    static metadata = {
        name: 'Net',
        metrics: [
            { key: 'down', color: true },
            { key: 'downerrors', color: true },
            { key: 'up', color: true },
            { key: 'uperrors', color: true },
            { key: 'collisions', color: true },
        ],
        panelLayout: 'dual',
        menuLayout: 'dual',
        dualIcons: ['go-down-symbolic', 'go-up-symbolic'],
        menuDualLabels: ['↓', '↑'],
        panelValueStyle: 'sm-net-value',
        panelUnitStyle: 'sm-net-unit-label',
        panelUnit: '',
        menuUnit: '',
    };

    constructor(extension, config) {
        super(extension, config);
        if (this.device_id !== 'all') {
            this.label.text = this.device_id;
            this.item_name = _('Net') + ' ' + this.device_id;
        }

        this.cursor = extension._Samplers.net.cursor();
        this._last = new Map();
        this._lastTime = 0;
        this._noEdgeLogged = false;
        this._missingLogged = false;
        this.tip_format([_('KiB/s'), '/s', _('KiB/s'), '/s', '/s']);
    }

    collectAsync(callback) {
        this.cursor.sample(reading => {
            if (this._destroyed || !reading?.data) {
                callback(null);
                return;
            }

            // Invariant: _last maps each interface summed at the previous tick
            // to that interface's counters at _lastTime. Every term below is
            // therefore a difference of two readings OF THE SAME INTERFACE, so
            // no term is negative and neither is the total. An interface
            // appearing or disappearing changes which terms exist, never the
            // sign of one.
            let totals = [0, 0, 0, 0, 0];
            let current = new Map();
            for (const [iface, now] of reading.data) {
                // A total counts the machine's edge, once. Summing a tunnel and
                // the wifi carrying it reports the same bytes twice. Naming an
                // interface is an explicit request for it, edge or not.
                if (this.device_id === 'all' ? !now.edge : iface !== this.device_id)
                    continue;
                current.set(iface, now);
                const prev = this._last.get(iface);
                // No previous reading means the interface has just appeared,
                // and how much traffic preceded it is not knowable. A counter
                // that went backwards is that same interface destroyed and
                // recreated under its own name -- the kernel zeroes the whole
                // stats struct, so bytes_in witnesses it for all five. Either
                // way it contributes nothing for one tick and re-baselines.
                if (!prev || now.bytes_in < prev.bytes_in)
                    continue;
                for (let i = 0; i < 5; i++)
                    totals[i] += now[FIELDS[i]] - prev[FIELDS[i]];
            }
            this._last = current;
            if (current.size) {
                this._noEdgeLogged = false;
                this._missingLogged = false;
            } else if (this.device_id === 'all') {
                // An aggregate is a fold over a set, and the empty set folds to
                // a real zero: this host's traffic genuinely never reaches its
                // edge.
                this._reportNoEdge(reading.data);
            } else {
                // A named interface that is not in /proc/net/dev has not been
                // measured, which is not the same as having carried nothing.
                this._reportMissing(reading.data);
                this._lastTime = reading.time * 0.001024;
                callback(null);
                return;
            }

            // The reading's own instant, not the clock now: a reading taken for
            // a faster sibling and consumed here is older than this tick, and
            // dividing by the wrong interval understates the rate.
            let time = reading.time * 0.001024;
            let delta = time - this._lastTime;
            let usage = [0, 0, 0, 0, 0];
            if (delta > 0) {
                for (let i = 0; i < 5; i++)
                    usage[i] = Math.round(totals[i] / delta);
            }
            this._lastTime = time;

            callback(this._present(usage));
        });
    }

    // A total of zero while traffic flows is the one way this rule looks broken,
    // and it happens on a host whose traffic never reaches a NIC -- between
    // local VMs over a bridge, say. The picker says what the total excludes;
    // this is for whoever never opens it.
    _reportNoEdge(interfaces) {
        if (this._noEdgeLogged)
            return;
        this._noEdgeLogged = true;
        sm_log(`${this.item_name}: no physical interface among ` +
               `${[...interfaces.keys()].join(', ')} — showing 0. If your traffic is ` +
               'between local machines, pick the bridge or tunnel it uses in preferences.', 'warn');
    }

    // An interface can be selected and then removed, or renamed by udev between
    // opening preferences and the panel reading it. The panel can only show 0;
    // which interfaces do exist is the difference between a mystery and a
    // one-line diagnosis.
    _reportMissing(interfaces) {
        if (this._missingLogged)
            return;
        this._missingLogged = true;
        sm_log(`${this.item_name}: /proc/net/dev lists ${[...interfaces.keys()].join(', ')} — ` +
               `nothing for "${this.device_id}". Showing --.`, 'warn');
    }

    _present(usage) {
        const Style = this.extension._Style;
        let downVal = usage[0];
        let upVal = usage[2];
        let speed_in_bits = this.config['speed-in-bits'] || false;

        if (speed_in_bits) {
            downVal = Math.round(downVal * 8.192);
            upVal = Math.round(upVal * 8.192);
        }

        let downFmt = this._computeSpeed(downVal);
        let upFmt = this._computeSpeed(upVal);
        let compact = Style.get('') === '-compact';

        return {
            metrics: {
                down: usage[0], downerrors: usage[1],
                up: usage[2], uperrors: usage[3],
                collisions: usage[4],
            },
            display: compact ? this._pad(downFmt.display, 4) : downFmt.display,
            display2: compact ? this._pad(upFmt.display, 4) : upFmt.display,
            unit: downFmt.panelUnit, unit2: upFmt.panelUnit,
            menuUnit: downFmt.tipUnit, menuUnit2: upFmt.tipUnit,
            tipVals: [downFmt.tipVal, usage[1], upFmt.tipVal, usage[3], usage[4]],
            tipUnits: [downFmt.tipUnit, '/s', upFmt.tipUnit, '/s', '/s'],
        };
    }

    _computeSpeed(val) {
        const Style = this.extension._Style;
        let speed_in_bits = this.config['speed-in-bits'] || false;
        let threshold, kPanel, kTip, mPanel, mTip, mDiv, gPanel, gTip, gDiv;
        if (speed_in_bits) {
            threshold = 1000;
            kPanel = Style.netunits_kbits(); kTip = _('kbit/s');
            mPanel = Style.netunits_mbits(); mTip = _('Mbit/s'); mDiv = 1000;
            gPanel = Style.netunits_gbits(); gTip = _('Gbit/s'); gDiv = 1000000;
        } else {
            threshold = 1024;
            kPanel = Style.netunits_kbytes(); kTip = _('KiB/s');
            mPanel = Style.netunits_mbytes(); mTip = _('MiB/s'); mDiv = 1024;
            gPanel = Style.netunits_gbytes(); gTip = _('GiB/s'); gDiv = 1048576;
        }

        if (val < threshold)
            return {display: val.toString(), panelUnit: kPanel, tipVal: val, tipUnit: kTip};
        if (val < threshold * threshold)
            return {display: (val / mDiv).toPrecision(3), panelUnit: mPanel, tipVal: (val / mDiv).toPrecision(3), tipUnit: mTip};
        return {display: (val / gDiv).toPrecision(3), panelUnit: gPanel, tipVal: (val / gDiv).toPrecision(3), tipUnit: gTip};
    }

    _pad(str, length) {
        while (str.length < length)
            str = ' ' + str;
        return str;
    }

}

export { Net };
