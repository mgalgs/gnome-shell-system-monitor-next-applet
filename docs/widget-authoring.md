# Custom Metrics and Widget Authoring

## Custom Metrics (No Code Changes)

The Prometheus widget lets you graph any metric in the panel without modifying the extension. Write a script that serves a [Prometheus metrics](https://prometheus.io/docs/instrumenting/writing_exporters/) endpoint, then point a Prometheus monitor at it.

### Example: Battery Power Draw

A Python script that exposes battery power draw as a Prometheus gauge:

`~/.local/bin/power-metrics-server-uv`
```python
#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["prometheus-client"]
# requires-python = ">=3.10"
# ///

from prometheus_client import Gauge, start_http_server
import os, threading

BAT = os.environ.get('BAT', 'BAT1')
SYSFS = f'/sys/class/power_supply/{BAT}'

def read_power():
    pf = os.path.join(SYSFS, 'power_now')
    if os.path.exists(pf):
        return int(open(pf).read()) / 1e6
    v = int(open(os.path.join(SYSFS, 'voltage_now')).read())
    i = int(open(os.path.join(SYSFS, 'current_now')).read())
    return v * i / 1e12

Gauge('power_watts', 'System power draw in watts').set_function(read_power)
start_http_server(int(os.environ.get('PORT', '19101')), addr='127.0.0.1')
threading.Event().wait()
```

Run it as a systemd user service:

`~/.config/systemd/user/power-metrics.service`
```ini
[Unit]
Description=Power draw Prometheus metrics exporter
After=network.target

[Service]
ExecStart=%h/.local/bin/power-metrics-server-uv
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now power-metrics.service
```

Then in the extension preferences: **Add Monitor → Prometheus**, set the server to `http://127.0.0.1:19101/metrics` and the metric name to `power_watts`.

This pattern works for anything you can measure — temperature probes, smart home sensors, CI queue depth, stock prices. If you can expose it as a Prometheus metric, you can graph it in the panel.

---

# Writing Widgets

This guide covers how to add a new system monitor widget to the extension.

## Minimal Widget (collect API)

The simplest possible widget reads a value and returns it. The framework handles everything else — panel label, text display, popup menu, tooltip, chart, visibility, style, refresh timer, and live config updates.

```javascript
import Gio from "gi://Gio";
import { ElementBase } from '../base.js';

const LoadAvg = class extends ElementBase {
    static metadata = {
        name: 'Load',
        metrics: [{ key: 'load1', color: true }],
    };

    collect() {
        let [, c] = Gio.File.new_for_path('/proc/loadavg').load_contents(null);
        return { load1: parseFloat(new TextDecoder().decode(c).split(' ')[0]) };
    }
}

export { LoadAvg };
```

That's it. `collect()` returns an object keyed by metric names. The framework:

- Shows `"load"` as the panel label (derived from name)
- Displays the value in the panel and popup menu
- Plots it on the area chart
- Shows it in the tooltip
- Refreshes on the configured timer interval

## Metadata Reference

```javascript
static metadata = {
    // Required
    name: 'Load',                              // Display name and menu label
    metrics: [{ key: 'load1', color: true }],  // Chart series

    // Optional identity
    id: 'loadavg',      // Type identifier. Default: name.toLowerCase()
    label: 'load',      // Panel label text. Default: name.toLowerCase().slice(0, 4)

    // Optional units
    panelUnit: '%',      // Unit shown next to value in panel. Default: '%'
    menuUnit: '%',       // Unit shown in popup menu. Default: panelUnit
    tooltipUnit: 'rpm',  // Unit shown in tooltip. Default: '' (no unit)

    // Optional layout declarations
    panelLayout: 'simple',    // 'simple' (default), 'dual', or 'icon'
    menuLayout: 'simple',     // 'simple' (default), 'detail', or 'dual'
    dualLabels: ['R', 'W'],   // Text labels for dual panel directions
    dualIcons: ['go-down-symbolic', 'go-up-symbolic'], // Icon names for dual panel (overrides dualLabels)
    menuDualLabels: ['R', 'W'], // Labels for dual menu (defaults to dualLabels)
    panelIcon: 'battery-good-symbolic', // Icon string for 'icon' panel layout
    detailUnit: 'GiB',  // Initial detail unit for 'detail' menu layout

    // Optional style overrides
    panelValueStyle: 'sm-status-value', // Panel value CSS class. Default: 'sm-status-value'
    panelUnitStyle: 'sm-perc-label',    // Panel unit CSS class. Default: derived from unit
};
```

### Metrics

Each entry in `metrics` defines a chart series:

```javascript
metrics: [
    { key: 'user', color: true },    // plotted on chart, gets a color config
    { key: 'system', color: true },
]
```

The `key` serves triple duty:
- Key in the object returned by `collect()`
- Color config key in the monitor's `colors` object (e.g. `colors.user`)
- Label shown in the tooltip

## Widget API

Three patterns for providing data, from simplest to most flexible:

### collect() — synchronous data

Return an object with keys matching your metric names. The framework updates the panel text, menu text, chart, and tooltip automatically.

```javascript
collect() {
    return { load1: 0.45, load5: 0.38 };
}
```

The first metric's value becomes the panel/menu display text. To override the display text or drive layout-specific slots, include well-known keys:

```javascript
collect() {
    let ratio = this.used / this.total;
    return {
        used: ratio,                    // metric value for chart
        display: Math.round(ratio * 100).toString(), // panel + menu text
    };
}
```

### collect() Return Keys

| Key           | Description                                               |
|---------------|-----------------------------------------------------------|
| `<metricKey>` | Raw values for chart and default tooltip                  |
| `display`     | Primary display text (default: first metric stringified)  |
| `display2`    | Second value for dual layouts                             |
| `menuDisplay` | Menu-specific display (overrides `display` for menu only) |
| `detail`      | Detail text for `'detail'` menu layout                    |
| `detailUnit`  | Dynamic detail unit text                                  |
| `unit`        | Dynamic unit text (updates panel + menu unit labels)      |
| `unit2`       | Dynamic second unit for dual layouts                      |
| `icon`        | `Gio.Icon` for `'icon'` panel layout                      |
| `tipVals`     | Array overriding auto-mapped tooltip values               |
| `tipUnits`    | Array overriding tooltip unit labels                      |

### collectAsync(callback) — async data

Same return shape as `collect()`, but for widgets that read data asynchronously (subprocess output, async file I/O):

```javascript
collectAsync(callback) {
    this.file.load_contents_async(null, (source, result) => {
        let [, contents] = source.load_contents_finish(result);
        let value = parseInt(new TextDecoder().decode(contents));
        callback({ fan0: value });
    });
}
```

Call `callback(data)` when the data is ready, or `callback(null)` if the read failed. The framework handles chart/tooltip updates after the callback fires.

**Do not implement both `collect()` and `refresh()`** — the framework checks for `collect` first and ignores `refresh`/`_apply` if it exists.

## Sharing a source between widgets

If your source contains data for more than one device — `/proc/stat` holds every core, one `nvidia-smi` call covers every GPU, one scrape covers every metric on a server — do not read it per widget. Take a cursor on a shared sampler in `sampling.js`, and whichever widget's tick fires first pays for the read while the rest ride it.

| Your widget uses | Take a cursor on | Where |
|------------------|------------------|-------|
| `collect()`      | `Sampler`        | `extension._Samplers.<name>.cursor()` |
| `collectAsync()` | `AsyncSampler`   | same, then `cursor.sample(reading => …)` |

```javascript
constructor(extension, config) {
    super(extension, config);
    this.cursor = extension._Samplers.cpu.cursor();   // once, here
}

collect() {
    const reading = this.cursor.sample();             // {gen, time, data}
    return { load1: reading.data.core(this.cpuid).user };
}
```

Three rules:

- **Use `reading.time` for rate arithmetic, never the clock at delivery.** A reading taken for a faster sibling is older than your tick, and dividing a real counter delta by the wrong interval reports the wrong rate. This is the one every widget in the tree got wrong before sampling existed, so it is the one you will copy wrong from the file next door.
- **Add a new shared source as a getter on `smSamplers`**, not as a module-level cache of its own. One place to look, one lifetime, one teardown.
- **Do not add your own `GLib.timeout_add` for refreshing.** `refresh-time` is served by a timer shared with every other widget on that interval, so a private one puts your widget out of step with the rest of the panel.

A sampler owns the read; it does not own a timer. Widgets keep their own tick and a cursor never repeats a reading, so a widget never sees data older than its own configured refresh interval.

## Constructor

Most simple widgets don't need a constructor at all — the framework handles initialization and schedules the first data update automatically.

When you do need a constructor (to set up data sources, compute derived state, etc.):

```javascript
constructor(extension, config) {
    super(extension, config);
    // Your init code here. No need to call this.update().
    this.gtop = new GTop.glibtop_mem();
}
```

**Don't call `this.update()`** — the framework schedules the first update via `idle_add` after construction completes.

## Available State

After `super(extension, config)`, these are available:

| Field             | Description                                                                  |
|-------------------|------------------------------------------------------------------------------|
| `this.config`     | Per-instance config object (display, style, colors, refresh-time, etc.)      |
| `this.device_id`  | Device identifier from `config.device` (`'all'`, `'0'`, sensor label, etc.)  |
| `this.extension`  | The extension instance                                                       |
| `this.item_name`  | Display name (from `metadata.name`, can be overridden)                       |
| `this.label`      | `St.Label` — the panel label widget (text set from metadata, can be changed) |
| `this.text_items` | Array of `St.Label`/`St.Icon` — panel value display elements                 |
| `this.menu_items` | Array of `St.Label` — popup menu display elements                            |
| `this.chart`      | `Chart` instance — the area graph                                            |
| `this.color_name` | Array of metric keys that have colors                                        |
| `this.colors`     | Array of parsed color values for chart rendering                             |
| `this.vals`       | Array of current chart values (set in `_apply()` or auto-set by `collect()`) |
| `this.tip_vals`   | Array of current tooltip values                                              |

## Multi-Device Support

A monitor config covers a **set** of devices, and the framework expands it into one widget per device before any widget is constructed. Widgets are unaffected by this: each one still monitors exactly one device and reads it from `this.device_id`.

```json
{
  "uuid": "a1b2c3", "type": "cpu",
  "devices": ["all", "0", "1", "2", "3"],
  "style": "graph", "graph-width": 20
}
```

That is one entry in preferences and five widgets in the panel. `"all"` is a device id like the others, meaning *the aggregate* — the total across every core — so "total plus each core" is a single selection.

A device entry may also be an object, in which case its extra keys override the shared body for that device alone:

```json
"devices": [
  {"id": "all", "show-text": true},
  {"id": "0", "show-text": false},
  {"id": "1", "show-text": false}
]
```

Preferences writes this longer form and only ever puts `show-text` in it, but any config key works — the override is a plain sparse patch applied over the shared settings.

Writing configs by hand (for a test preset, say), the bare list of ids is enough. The older single-`device` form still loads too:

```json
{"uuid": "cfg-cpu", "type": "cpu", "device": "all"}
```

### What a widget sees

Each expanded widget receives a config with `device` set to its own id, so nothing in a widget changes. Two extra fields identify where it came from:

| Field         | Description                                                  |
|---------------|--------------------------------------------------------------|
| `device`      | This widget's device id — what `this.device_id` reads         |
| `monitorUuid` | The uuid of the preferences entry that produced this widget    |
| `uuid`        | Internal widget key; not addressable by the user, do not log it |

A widget's device never changes over its lifetime. The widget key is derived from (monitor uuid, device id), so changing which devices a monitor covers adds and removes widgets rather than mutating one — which is why `device_id` can be cached in the constructor.

The config's `device` field determines which device to monitor:

```javascript
constructor(extension, config) {
    super(extension, config);

    if (this.device_id === 'all') {
        // Monitor aggregate (all CPUs, all interfaces, etc.)
    } else {
        // Monitor specific device
        this.coreIndex = parseInt(this.device_id);
        this.label.text = 'CPU' + (this.coreIndex + 1);
        this.item_name = _('CPU') + ' ' + (this.coreIndex + 1);
    }
}
```

Common device_id patterns:
- `'all'` — aggregate (CPU total, all network interfaces)
- `'default'` — singleton (memory, swap, battery)
- `'0'`, `'1'`, ... — indexed device (CPU core, GPU index)
- Sensor label string — named device (thermal/fan sensors)

Users pick devices from a checklist in the preferences "Add Monitor" dialog, and can change the selection later from the monitor's row.

### Declaring a new type's devices

Preferences builds that checklist from `detectCatalog(type)` in `prefs.js`, which returns one of two shapes:

```javascript
// Nothing to choose: the source is the machine itself (memory, swap, battery)
{kind: 'singleton', device: {id: 'default', name: 'Default'}}

// A set of members, optionally with a total folded over them
{kind: 'set', aggregate: {id: 'all', name: 'All cores (total)'}, members: [{id: '0', name: 'Core 1'}, ...]}
```

Use `aggregate: null` when the type has no meaningful total (GPUs, thermal sensors, fans). Members carry a display name because a checklist reading "0 1 2 3" is unusable — and if detection cannot confirm a device but the widget might still work with it, keep the entry and say so in its name rather than presenting it as found.

## Declarative Layouts

The framework builds panel and menu UI from metadata declarations. Widget authors declare layout intent; the framework builds the labels and populates them from `collect()` return keys.

### Panel Layouts

**`simple`** (default) — `[value] [unit]`
```javascript
static metadata = { panelUnit: '%', ... };
collect() { return { value: 42, display: '42' }; }
```

**`dual`** — `[dir₁] [value₁] [unit] [dir₂] [value₂] [unit]`
```javascript
static metadata = {
    panelLayout: 'dual',
    dualLabels: ['R', 'W'],   // or dualIcons for icon indicators
    panelUnit: 'MiB/s',
    ...
};
collect() { return { read: 1.5, write: 0.8, display: '1.5', display2: '0.8' }; }
```

**`icon`** — `[icon] [value] [unit]`
```javascript
static metadata = {
    panelLayout: 'icon',
    panelIcon: '. GThemedIcon battery-good-symbolic',
    ...
};
collect() { return { batt0: 85, display: '85', icon: someGioIcon }; }
```

### Menu Layouts

**`simple`** (default) — `[value] [unit]`

**`detail`** — `[value] [unit] [gap] [detail] [detailUnit]`
```javascript
static metadata = { menuLayout: 'detail', ... };
collect() { return { used: 0.6, display: '60', detail: '9.6 / 16.0', detailUnit: 'GiB' }; }
```

**`dual`** — `[value₁] [unit] [dir₁] [value₂] [unit] [dir₂]`
```javascript
static metadata = {
    menuLayout: 'dual',
    menuDualLabels: ['R', 'W'],  // defaults to dualLabels
    ...
};
```

### Dynamic Units

For widgets whose units change at runtime (Network's KiB/s → MiB/s), return `unit`/`unit2` from collect():
```javascript
collect() {
    return { ..., unit: currentUnit, unit2: currentUnit2 };
}
```

## Wiring a New Widget

After writing the widget class, register it with the extension:

1. Export the class from `widgets/yourwidget.js`
2. Import it in `extension.js`
3. Add it to the `WIDGET_CLASSES` map:
   ```javascript
   const WIDGET_CLASSES = {
       // ...existing entries...
       loadavg: LoadAvg,
   };
   ```
4. Add the type to `MONITOR_TYPES` in `prefs.js` and provide entries in `TYPE_NAMES`, `COLOR_MAP`, `DEFAULT_COLORS`, and `detectCatalog()` for the new type
5. Add color key(s) to the schema XML if the widget has configurable colors

## Examples by Complexity

**Minimal** — `collect()` only, no constructor: see LoadAvg example above

**Async data** — `collectAsync(callback)`: Fan widget reads hwmon sysfs files asynchronously, calls `callback({fan0: rpm})` when data arrives

**Detail menu** — Memory widget: `menuLayout: 'detail'`, collect() returns `{display, detail, detailUnit}` for `60%  9.6 / 16.0 GiB`

**Dual layout** — Disk widget: `panelLayout: 'dual'`, `menuLayout: 'dual'`, collect() returns `{display, display2, unit, unit2}` for R/W values

**Dynamic units** — Network widget: dual layout with `dualIcons` for panel arrows, collect() returns changing `unit`/`unit2` (KiB/s → MiB/s → GiB/s)

**Icon layout** — Battery widget: `panelLayout: 'icon'`, collect() returns `{icon, unit}` to update the battery icon and toggle between % and hours

**Event-driven** — Battery — doesn't use the refresh timer at all; updates via UPower D-Bus proxy callbacks
