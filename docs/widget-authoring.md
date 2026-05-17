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

    // Optional — all have sensible defaults
    id: 'loadavg',      // Type identifier. Default: name.toLowerCase()
    label: 'load',      // Panel label text. Default: name.toLowerCase().slice(0, 4)
    panelUnit: '%',      // Unit shown next to value in panel. Default: '%'
    menuUnit: '%',       // Unit shown in popup menu. Default: panelUnit
    tooltipUnit: 'rpm',  // Unit shown in tooltip. Default: '' (no unit)
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

## Widget API: collect() vs refresh()/\_apply()

There are two patterns for providing data. Use `collect()` for simple widgets; use `refresh()` + `_apply()` when you need full control.

### collect() — simple path

Return an object with keys matching your metric names. The framework updates the panel text, menu text, chart, and tooltip automatically.

```javascript
collect() {
    return { load1: 0.45, load5: 0.38 };
}
```

The first metric's value becomes the panel/menu display text. All metrics feed the chart and tooltip.

### refresh() + \_apply() — full control

For widgets with complex display formatting (multiple text items, dynamic units, computed values), implement both methods:

```javascript
refresh() {
    // Fetch raw data, store on this
    GTop.glibtop_get_mem(this.gtop);
    this.mem = Math.round(this.gtop.user / 1024 / 1024);
    this.total = Math.round(this.gtop.total / 1024 / 1024);
}

_apply() {
    // Format data into display elements
    let percent = Math.round(this.mem / this.total * 100);
    this.text_items[0].text = percent.toString();  // panel value
    this.menu_items[0].text = percent.toString();  // menu value
    this.vals = [this.mem / this.total];           // chart (0-1 range)
    this.tip_vals[0] = percent;                    // tooltip
}
```

`refresh()` runs first to collect data, then `_apply()` formats it for display. The framework calls `chart.update()` and updates tooltip labels after `_apply()` returns.

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

## Custom Text/Menu Layout

The default `create_text_items()` returns `[value_label, unit_label]` and `create_menu_items()` returns `[value_label, unit_label]`. Override these for custom layouts:

```javascript
// Disk widget: read/write with separate values and units
create_text_items() {
    const Style = this.extension._Style;
    return [
        new St.Label({text: 'R', style_class: Style.get('sm-status-label')}),
        new St.Label({text: '', style_class: Style.get('sm-disk-value')}),
        new St.Label({text: 'MiB/s', style_class: Style.get('sm-disk-unit-label')}),
        new St.Label({text: 'W', style_class: Style.get('sm-status-label')}),
        new St.Label({text: '', style_class: Style.get('sm-disk-value')}),
        new St.Label({text: 'MiB/s', style_class: Style.get('sm-disk-unit-label')}),
    ];
}
```

When overriding text/menu items, you must also use `refresh()` + `_apply()` (not `collect()`) since the auto-apply logic only handles the default layout.

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

**Simple with state** — constructor + `collect()`: Fan widget sets up sensor detection in constructor, could use collect() to return `{ fan0: this.rpm }`

**Medium** — `refresh()` + `_apply()` with custom menu: Memory, Swap — need custom menu layout showing `used / total` alongside percentage

**Complex** — custom everything: Network — custom text items (up/down arrows + values + dynamic units), custom menu items, dynamic unit switching (bits vs bytes), interface detection

**Event-driven** — Battery — doesn't use the refresh timer at all; updates via UPower D-Bus proxy callbacks
