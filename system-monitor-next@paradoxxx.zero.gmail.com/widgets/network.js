/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import NM from "gi://NM";
import { ElementBase } from '../base.js';

const NetworkManager = NM;

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
        this.ifs = [];
        this.client = NM.Client.new(null);
        this.update_iface_list();

        if (!this.ifs.length)
            this._detectInterfacesAsync();

        if (this.device_id !== 'all') {
            this.label.text = this.device_id;
            this.item_name = _('Net') + ' ' + this.device_id;
        }

        this.cursor = extension._Samplers.net.cursor();
        this._last = new Map();
        this._lastTime = 0;
        this.tip_format([_('KiB/s'), '/s', _('KiB/s'), '/s', '/s']);
        try {
            let iface_list = this.client.get_devices();
            this._nmDevices = [];
            for (let j = 0; j < iface_list.length; j++) {
                let device = iface_list[j];
                device.connectObject('state-changed', this.update_iface_list.bind(this), this);
                this._nmDevices.push(device);
            }
        } catch (e) {
            console.error('Please install Network Manager Gobject Introspection Bindings: ' + e);
        }
    }

    _detectInterfacesAsync() {
        Gio.File.new_for_path('/proc/net/dev').load_contents_async(null, (file, result) => {
            if (this._destroyed) return;
            try {
                let [, contents] = file.load_contents_finish(result);
                let lines = new TextDecoder().decode(contents).split('\n');
                for (let i = 2; i < lines.length - 1; i++) {
                    let ifc = lines[i].replace(/^\s+/g, '').split(':')[0];
                    if (ifc.indexOf('br') >= 0 || ifc.indexOf('lo') >= 0)
                        continue;
                    this._checkOperstate(ifc);
                }
            } catch { /* /proc/net/dev unavailable */ }
        });
    }

    _checkOperstate(ifc) {
        Gio.File.new_for_path('/sys/class/net/' + ifc + '/operstate')
            .load_contents_async(null, (opFile, opResult) => {
                if (this._destroyed) return;
                try {
                    let [, opContents] = opFile.load_contents_finish(opResult);
                    if (new TextDecoder().decode(opContents).replace(/\s/g, '') === 'up') {
                        if (this.device_id === 'all' || this.device_id === ifc)
                            this.ifs.push(ifc);
                    }
                } catch { /* operstate file may not exist */ }
            });
    }

    update_iface_list() {
        try {
            this.ifs = [];
            let iface_list = this.client.get_devices();
            for (let j = 0; j < iface_list.length; j++) {
                if (iface_list[j].state === NetworkManager.DeviceState.ACTIVATED) {
                    let iface = iface_list[j].get_ip_iface() || iface_list[j].get_iface();
                    if (this.device_id === 'all' || this.device_id === iface)
                        this.ifs.push(iface);
                }
            }
        } catch {
            console.error('Please install Network Manager Gobject Introspection Bindings');
        }
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
            for (const iface of this.ifs) {
                const now = reading.data.get(iface);
                if (!now)
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

    destroy() {
        if (this._nmDevices) {
            for (const device of this._nmDevices)
                device.disconnectObject(this);
            this._nmDevices = null;
        }
        super.destroy();
    }
}

export { Net };
