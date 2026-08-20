/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// system-monitor: Gnome shell extension displaying system informations in gnome shell status bar, such as memory usage, cpu usage, network rates…
// Copyright (C) 2011 Florian Mounier aka paradoxxxzero

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// A monitor is a set of devices, and most sets have one member. This module is
// the only place either shape is built: parseMonitorConfigs turns the loose
// `monitors` setting into configs the rest of the extension can trust, and
// expandMonitor turns one config into one derived config per selected device.

import { sm_log } from './utils.js';

// A monitor covering more devices than this is a corrupt or hand-mangled
// config; expanding it would spawn that many Cairo charts in the panel.
const MAX_DEVICES_PER_MONITOR = 64;

// A device entry may not restate what the monitor owns. `type` is the dangerous
// one: without this, an entry could build a Gpu widget inside a cpu monitor.
const RESERVED_ENTRY_KEYS = ['type', 'uuid', 'devices', 'device'];

// Injective on (uuid, deviceId) for arbitrary strings, so two devices can never
// collide onto one widget -- device ids are free text (sensor labels) and a
// separator-joined key would need a character ban to stay unique. Only ever
// joined, never split: both halves ride on the derived config as `monitorUuid`
// and `device`.
function widget_key(monitorUuid, deviceId) {
    return JSON.stringify([monitorUuid, deviceId]);
}

function normalize_entries(raw, label) {
    let list = raw.devices;
    if (list === undefined && typeof raw.device === 'string') {
        list = [raw.device];
    }
    if (!Array.isArray(list) || list.length === 0) {
        sm_log(`${label}: no devices listed - expected "devices": ["all"]. Skipping; it will not appear in the panel.`, 'warn');
        return null;
    }

    const entries = [];
    const seen = new Set();
    for (const item of list) {
        const source = typeof item === 'string' ? {id: item} : item;
        if (!source || typeof source.id !== 'string') {
            sm_log(`${label}: device entry without an id, ignoring it.`, 'warn');
            continue;
        }
        if (seen.has(source.id)) {
            sm_log(`${label}: device "${source.id}" listed twice, keeping the first.`, 'warn');
            continue;
        }
        seen.add(source.id);

        const {id, ...override} = source;
        for (const key of RESERVED_ENTRY_KEYS) {
            if (key in override) {
                sm_log(`${label}: device "${id}" tries to override "${key}", which the monitor owns. Ignoring it.`, 'warn');
                delete override[key];
            }
        }
        entries.push({id, ...override});

        if (entries.length === MAX_DEVICES_PER_MONITOR) {
            if (list.length > MAX_DEVICES_PER_MONITOR) {
                sm_log(`${label}: ${list.length} devices listed, keeping the first ${MAX_DEVICES_PER_MONITOR}. ` +
                       'Split this into two monitors if you need more.', 'warn');
            }
            break;
        }
    }

    if (entries.length === 0) {
        sm_log(`${label}: no usable devices. Skipping; it will not appear in the panel.`, 'warn');
        return null;
    }
    return entries;
}

// Parse the `monitors` strv into canonical configs. Malformed entries are
// skipped with a warning, never silently repaired: the settings key is
// user-editable and a monitor quietly doing nothing reads as a bug.
function parseMonitorConfigs(strv) {
    const configs = [];
    const uuids = new Set();
    let skipped = 0;

    for (const s of strv) {
        let raw;
        try {
            raw = JSON.parse(s);
        } catch (e) {
            sm_log(`Skipping malformed monitor config: ${e.message}`, 'warn');
            skipped++;
            continue;
        }
        if (!raw || typeof raw.uuid !== 'string' || typeof raw.type !== 'string') {
            sm_log('Skipping a monitor config with no uuid and type.', 'warn');
            skipped++;
            continue;
        }

        const label = `Monitor ${raw.uuid} (${raw.type})`;
        // Two monitors sharing a uuid expand to the same widget key, which puts
        // one widget object in the panel list twice and throws when the second
        // copy is parented.
        if (uuids.has(raw.uuid)) {
            sm_log(`${label}: uuid already used by an earlier monitor. Skipping; give it its own uuid.`, 'warn');
            skipped++;
            continue;
        }

        const devices = normalize_entries(raw, label);
        if (!devices) {
            skipped++;
            continue;
        }

        uuids.add(raw.uuid);
        const config = {...raw, devices};
        delete config.device;
        configs.push(config);
    }

    if (skipped > 0) {
        const widgets = configs.reduce((n, c) => n + c.devices.length, 0);
        sm_log(`Loaded ${configs.length} of ${strv.length} configured monitors (${widgets} panel widgets).`, 'warn');
    }
    return configs;
}

// One config per selected device, in selection order. The entry's remaining
// keys are a sparse patch over the shared body, so per-device settings beyond
// show-text cost nothing to add later.
function expandMonitor(config) {
    return config.devices.map(({id, ...override}) => {
        const derived = {...config, ...override};
        delete derived.devices;
        derived.device = id;
        derived.uuid = widget_key(config.uuid, id);
        derived.monitorUuid = config.uuid;
        return derived;
    });
}

function expandMonitors(configs) {
    return configs.flatMap(expandMonitor);
}

export { parseMonitorConfigs, expandMonitor, expandMonitors, MAX_DEVICES_PER_MONITOR };
