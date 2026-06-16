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

Widgets support monitoring specific devices via `this.device_id`. The config's `device` field determines which device to monitor:

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

Users add multi-device instances through the preferences "Add Monitor" dialog.

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
4. Add the type to `MONITOR_TYPES` in `prefs.js` and provide entries in `COLOR_MAP`, `DEFAULT_COLORS`, and `detectDevices()` for the new type
5. Add color key(s) to the schema XML if the widget has configurable colors

## Examples by Complexity

**Minimal** — `collect()` only, no constructor: see LoadAvg example above

**Async data** — `collectAsync(callback)`: Fan widget reads hwmon sysfs files asynchronously, calls `callback({fan0: rpm})` when data arrives

**Detail menu** — Memory widget: `menuLayout: 'detail'`, collect() returns `{display, detail, detailUnit}` for `60%  9.6 / 16.0 GiB`

**Dual layout** — Disk widget: `panelLayout: 'dual'`, `menuLayout: 'dual'`, collect() returns `{display, display2, unit, unit2}` for R/W values

**Dynamic units** — Network widget: dual layout with `dualIcons` for panel arrows, collect() returns changing `unit`/`unit2` (KiB/s → MiB/s → GiB/s)

**Icon layout** — Battery widget: `panelLayout: 'icon'`, collect() returns `{icon, unit}` to update the battery icon and toggle between % and hours

**Event-driven** — Battery — doesn't use the refresh timer at all; updates via UPower D-Bus proxy callbacks
