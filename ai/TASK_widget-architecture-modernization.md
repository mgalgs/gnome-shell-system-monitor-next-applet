# Incremental Widget Architecture Modernization

## Executive Summary

Modernize the GNOME Shell System Monitor extension's widget architecture from a monolithic 2700-line `extension.js` file to a modular, plugin-based system with a simplified widget API. The modernization will be **incremental**—introducing a new architecture alongside the existing one, allowing widgets to be migrated one-by-one without disrupting the working extension.

**First Migration Target:** Memory widget (`Mem` class)

## Current State Analysis

### Architecture Overview

The current architecture uses a classical inheritance hierarchy:

```
St.BoxLayout (GObject/Clutter base)
    ↓
TipBox (tooltip functionality)
    ↓
ElementBase (widget foundation - 233 lines)
    ↓
Widget Classes (Mem, Cpu, Disk, Net, etc.)
```

### Current Widget Requirements

Every widget currently must:

1. **Extend ElementBase** with specific constructor properties:
   ```javascript
   super(extension, {
       elt: 'memory',              // Settings key prefix
       elt_short: 'mem',          // Short name
       item_name: _('Memory'),    // Menu title
       color_name: ['program', 'buffer', 'cache']  // Graph color keys
   });
   ```

2. **Implement four abstract methods:**
   - `refresh()` - Fetch system data (GTop, etc.)
   - `_apply()` - Convert raw data to display values
   - `create_text_items()` - Return St.Label array for status bar
   - `create_menu_items()` - Return St.Label array for dropdown menu

3. **Populate three data arrays:**
   - `this.vals[]` - Normalized values (0.0-1.0) for graphing
   - `this.tip_vals[]` - Tooltip display values
   - `this.text_items[i].text` and `this.menu_items[i].text` - UI labels

4. **Access extension singleton** for:
   - Settings: `this.extension._Schema`
   - Styles: `this.extension._Style`
   - Resources: `this.extension._IconSize`, `this.extension._Locale`, etc.

### Key Pain Points

1. **Tight Coupling:** Widgets directly access extension singleton for settings, styles, resources
2. **No Separation of Concerns:** Widget logic, UI rendering, data collection, settings management all mixed
3. **Hard to Test:** Widgets require full extension object and GNOME Shell environment
4. **High Boilerplate:** ~100+ lines of boilerplate per widget for settings connections, UI creation, menu items
5. **Monolithic File:** All widgets in single 2700-line file makes navigation difficult
6. **Implicit Contracts:** Many undocumented requirements (e.g., `vals.length === colors.length`)

## Vision: Modern Widget API

### User-Facing Simplicity

Creating a new widget should be simple and focused on **data collection only**:

```javascript
// widgets/wireguard-widget.js
import { Widget } from '../widget-system/Widget.js';

export default class WireguardWidget extends Widget {
    static metadata = {
        id: 'wireguard',
        name: 'WireGuard',
        description: 'Monitor WireGuard VPN traffic',
        metrics: [
            { key: 'rx', label: 'RX', color: '#00ff00' },
            { key: 'tx', label: 'TX', color: '#ff0000' }
        ]
    };

    initialize() {
        // One-time setup: create GTop objects, open files, etc.
        this.lastRx = 0;
        this.lastTx = 0;
    }

    collect() {
        // Called periodically - return current metric values
        const stats = this._readWgStats();  // Widget-specific logic
        return {
            rx: stats.rx - this.lastRx,
            tx: stats.tx - this.lastTx
        };
    }

    destroy() {
        // Optional: cleanup resources
    }
}
```

**That's it.** No manual UI creation, no settings boilerplate, no menu item management.

### Widget System Responsibilities

The new widget system handles:

- **Settings Management:** Auto-generate settings schema, provide simple config API
- **UI Rendering:** Auto-create status bar labels, graphs, menu items based on metrics
- **Update Scheduling:** Manage refresh timers, handle errors, debouncing
- **Color Management:** Handle color settings, theme changes, graph rendering
- **Menu Integration:** Build dropdown menu items automatically
- **Tooltip System:** Generate tooltips from metric data
- **Lifecycle:** Initialize, enable, disable, destroy widgets properly

## Architecture Design

### Core Components

```
widget-system/
├── Widget.js              # Base widget class (simplified API)
├── WidgetRegistry.js      # Plugin registry and loader
├── WidgetSettingsAdapter.js  # Settings abstraction layer
├── WidgetRenderer.js      # UI creation and graph rendering
├── WidgetScheduler.js     # Update timer management
└── LegacyBridge.js        # Compatibility layer with existing extension

widgets/
├── memory-widget.js       # NEW: Modern memory widget
├── cpu-widget.js          # (future)
├── network-widget.js      # (future)
└── ...

extension.js               # EXISTING: Keep legacy widgets working
```

### Widget Lifecycle

```
1. Registration Phase (extension.js)
   WidgetRegistry.register(MemoryWidget);
   WidgetRegistry.register(CpuWidget);
   ...

2. Initialization Phase (extension enable)
   widget = WidgetRegistry.create('memory', extensionContext);
   widget.initialize();

3. Runtime Phase
   - Scheduler calls widget.collect() periodically
   - Renderer updates UI with collected data
   - Settings changes trigger reconfiguration

4. Cleanup Phase (extension disable)
   widget.destroy();
```

### Settings Abstraction

**Current:** `this.extension._Schema.get_int('memory-refresh-time')`

**New:** `this.config.getInt('refresh-time')`

The `WidgetSettingsAdapter` wraps GSettings with:
- Automatic key prefixing (`memory-` prefix added automatically)
- Type-safe accessors (`getInt()`, `getBoolean()`, `getString()`)
- Simple connection: `this.config.onChange('refresh-time', callback)`
- Default values from metadata

### Rendering Abstraction

**Current:** Widget manually creates `create_text_items()`, `create_menu_items()`, manages Chart

**New:** `WidgetRenderer` auto-generates UI from metric metadata:

```javascript
// Metrics defined in Widget.metadata:
metrics: [
    { key: 'program', label: 'Program', color: '#0000ff' },
    { key: 'buffer', label: 'Buffer', color: '#00ff00' },
    { key: 'cache', label: 'Cache', color: '#ff0000' }
]

// Renderer automatically creates:
// - Status bar labels (showing totals or percentages)
// - Graph with 3 colored areas
// - Menu items with breakdown
// - Tooltips with per-metric values
```

### Dual-Mode Operation (Incremental Migration Strategy)

The system must support **both old and new widgets simultaneously**:

```javascript
// extension.js enable()
function enable() {
    // ... existing code ...

    // === LEGACY WIDGETS (existing) ===
    const legacyCpuWidgets = createCpus(this);  // Old way
    const legacyNetWidget = new Net(this);      // Old way

    // === NEW WIDGETS (modern) ===
    if (WidgetRegistry.isAvailable('memory')) {
        const modernMemoryWidget = WidgetRegistry.create('memory', this);
        // LegacyBridge wraps modern widget to expose old ElementBase interface
        const legacyCompatWidget = LegacyBridge.wrap(modernMemoryWidget);
        positionList.push([this._Schema.get_int('memory-position'), legacyCompatWidget]);
    } else {
        // Fallback to old widget if modern version not available
        const legacyMemWidget = new Mem(this);
        positionList.push([this._Schema.get_int('memory-position'), legacyMemWidget]);
    }

    // Menu building, sorting, etc. works unchanged
    // because LegacyBridge exposes same interface as ElementBase
}
```

**Key Design Principle:** Modern widgets are **wrapped** to expose the old `ElementBase` interface, allowing seamless integration without rewriting the extension's widget management code.

## Implementation Plan

### Phase 1: Widget System Foundation

**Goal:** Create the new widget architecture without breaking anything.

#### 1.1 Create Directory Structure

```bash
mkdir -p system-monitor-next@paradoxxx.zero.gmail.com/widget-system
mkdir -p system-monitor-next@paradoxxx.zero.gmail.com/widgets
```

#### 1.2 Implement Core Widget System Classes

**Widget.js** - Base class for modern widgets
- Properties: `id`, `metadata`, `config`, `renderer`, `scheduler`
- Methods: `initialize()`, `collect()`, `destroy()`
- Validation: Ensure metadata is complete
- Lifecycle management

**WidgetRegistry.js** - Plugin management
- `register(WidgetClass)` - Add widget to registry
- `create(widgetId, extension)` - Instantiate widget
- `isAvailable(widgetId)` - Check if widget exists
- `list()` - Get all registered widget IDs

**WidgetSettingsAdapter.js** - Settings wrapper
- Constructor: `new WidgetSettingsAdapter(schema, prefix)`
- Methods: `getInt(key)`, `getBoolean(key)`, `getString(key)`, `getColor(key)`
- Methods: `onChange(key, callback)`, `disconnect(signalId)`
- Auto-prefix all keys with `{widgetId}-`

**WidgetRenderer.js** - UI generation
- `createStatusBarLabels(metrics, data)` - Generate St.Labels for panel
- `createMenuItems(metrics, data)` - Generate St.Labels for dropdown
- `createGraph(metrics, width, height)` - Create Chart with colors
- `update(data)` - Update all UI elements with new data
- Handle display modes: digit, graph, both

**WidgetScheduler.js** - Update timing
- `start(widget, interval)` - Begin periodic collect() calls
- `stop()` - Cancel timer
- `setInterval(ms)` - Change refresh rate
- Error handling: Log failures, continue scheduling

**LegacyBridge.js** - Compatibility layer
- `wrap(modernWidget)` - Returns object with ElementBase interface
- Exposes: `.actor`, `.refresh()`, `.update()`, `.destroy()`, etc.
- Translates modern widget API to legacy extension expectations
- This is the **critical piece** for incremental migration

#### 1.3 Define Widget Metadata Schema

**JSON Schema for Widget.metadata:**

```javascript
{
    id: 'memory',                    // Unique identifier (settings prefix)
    name: 'Memory',                  // Display name (i18n key)
    description: 'RAM usage',        // Description
    version: '1.0.0',               // Widget version

    metrics: [                       // Array of data series
        {
            key: 'program',          // Unique within widget
            label: 'Program',        // Display label
            color: '#0000ff',        // Default graph color
            unit: 'MiB'             // Optional: display unit
        },
        // ...
    ],

    settings: {                      // Optional: custom settings beyond defaults
        'custom-threshold': {
            type: 'integer',
            default: 80,
            description: 'Alert threshold percentage'
        }
    },

    dependencies: ['GTop']          // Optional: required libraries
}
```

### Phase 2: Memory Widget Migration

**Goal:** Migrate `Mem` class from monolithic extension.js to standalone modern widget, maintaining 100% feature parity.

#### 2.1 Extract Memory Widget Implementation

**File:** `widgets/memory-widget.js`

```javascript
import { Widget } from '../widget-system/Widget.js';
import GTop from 'gi://GTop';

export default class MemoryWidget extends Widget {
    static metadata = {
        id: 'memory',
        name: 'Memory',
        description: 'Monitor RAM usage',
        metrics: [
            { key: 'program', label: 'Program', color: '#0000ff', unit: 'MiB' },
            { key: 'buffer', label: 'Buffer', color: '#00ff00', unit: 'MiB' },
            { key: 'cache', label: 'Cache', color: '#ff0000', unit: 'MiB' }
        ]
    };

    initialize() {
        this.gtop = new GTop.glibtop_mem();
        GTop.glibtop_get_mem(this.gtop);
        this.total = Math.round(this.gtop.total / 1024 / 1024);

        // Determine display unit (MiB or GiB)
        this.unitConversion = this.config.getBoolean('byte-size-binary-prefix')
            ? 1024
            : 1000;

        if (this.total > this.unitConversion) {
            this.total = Math.round(this.total / this.unitConversion);
            this.metadata.metrics.forEach(m => m.unit = 'GiB');
        }
    }

    collect() {
        GTop.glibtop_get_mem(this.gtop);

        const program = this.gtop.user / 1024 / 1024;
        const cache = this.gtop.cached / 1024 / 1024;
        const buffer = this.gtop.buffer / 1024 / 1024;

        const divisor = this.total > this.unitConversion ? this.unitConversion : 1;

        return {
            program: Math.round(program / divisor),
            buffer: Math.round(buffer / divisor),
            cache: Math.round(cache / divisor),

            // Normalized values for graphing (0.0 - 1.0)
            _normalized: {
                program: program / divisor / this.total,
                buffer: buffer / divisor / this.total,
                cache: cache / divisor / this.total
            },

            // Total for display (used in menu, tooltips)
            _total: this.total
        };
    }

    destroy() {
        // GTop objects don't need explicit cleanup
    }
}
```

#### 2.2 Register Modern Memory Widget

**File:** `widgets/index.js` (new file)

```javascript
import MemoryWidget from './memory-widget.js';

export default function registerAllWidgets(registry) {
    registry.register(MemoryWidget);
    // Future widgets registered here
}
```

#### 2.3 Update Extension Integration

**File:** `extension.js`

Add near top of file:

```javascript
import { WidgetRegistry } from './widget-system/WidgetRegistry.js';
import { LegacyBridge } from './widget-system/LegacyBridge.js';
import registerAllWidgets from './widgets/index.js';
```

In `enable()` method, modify memory widget creation:

```javascript
// Around line 2650, replace:
//   const memWidget = new Mem(this);
// With:

let memWidget;
if (USE_MODERN_WIDGETS) {  // Feature flag for testing
    const modernMem = WidgetRegistry.create('memory', this);
    memWidget = LegacyBridge.wrap(modernMem);
} else {
    memWidget = new Mem(this);  // Legacy fallback
}
positionList.push([this._Schema.get_int('memory-position'), memWidget]);
```

#### 2.4 Testing Strategy

**Test Plan:**

1. **Functionality Tests:**
   - Memory widget appears in panel with correct values
   - Graph renders with 3 colored areas (program, buffer, cache)
   - Status bar shows percentage or absolute values based on settings
   - Dropdown menu shows breakdown of memory usage
   - Tooltips display on hover with correct data

2. **Settings Tests:**
   - Toggle `memory-display` - widget shows/hides
   - Change `memory-refresh-time` - update interval changes
   - Change `memory-graph-width` - graph resizes
   - Toggle `memory-show-text` - label visibility
   - Toggle `memory-show-menu` - menu item visibility
   - Change colors - graph updates correctly
   - Change `memory-style` (digit/graph/both) - display mode changes

3. **Compatibility Tests:**
   - Other widgets (CPU, Network, etc.) continue working unchanged
   - Extension enable/disable cycles work correctly
   - Memory widget position in panel respects `memory-position` setting
   - Menu building includes memory widget in correct row

4. **Edge Cases:**
   - Binary vs decimal prefix setting (`byte-size-binary-prefix`)
   - Systems with < 1 GiB memory (stays in MiB)
   - Systems with > 1 GiB memory (switches to GiB)
   - Theme changes (graph background color updates)
   - Compact display mode (label rotation, font sizes)

5. **Performance Tests:**
   - Update timers don't drift or accumulate
   - No memory leaks over 1000+ update cycles
   - CPU usage similar to legacy implementation
   - Graph rendering performance unchanged

**Test Execution:**

```bash
# Install with modern widget enabled
USE_MODERN_WIDGETS=true make uninstall install gschemas.install-and-compile

# Reload GNOME Shell
# X11:
./reload-gs.sh
# Wayland:
dbus-run-session -- gnome-shell --nested --wayland

# Enable extension in nested session
gnome-extensions enable system-monitor-next@paradoxxx.zero.gmail.com

# Monitor logs
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "system-monitor"
```

### Phase 3: Documentation and Migration Guide

#### 3.1 Widget Developer Guide

**File:** `docs/WIDGET_DEVELOPMENT.md`

Contents:
- Modern widget API reference
- Metadata schema documentation
- Examples: Simple widget (single metric), complex widget (multiple metrics)
- Settings integration guide
- Testing guide
- Migration from legacy guide

#### 3.2 Architecture Documentation

**File:** `docs/ARCHITECTURE.md`

Contents:
- High-level architecture overview
- Directory structure explanation
- Component responsibilities
- Data flow diagrams
- Legacy vs modern comparison
- Migration strategy

#### 3.3 Migration Checklist

**File:** `docs/MIGRATION_CHECKLIST.md`

Checklist for migrating each widget:
- [ ] Create `widgets/{name}-widget.js`
- [ ] Define metadata (id, name, metrics)
- [ ] Implement `initialize()`
- [ ] Implement `collect()`
- [ ] Implement `destroy()` if needed
- [ ] Register in `widgets/index.js`
- [ ] Update extension.js to use `WidgetRegistry.create()`
- [ ] Test all functionality
- [ ] Test all settings
- [ ] Update documentation
- [ ] Mark legacy widget for removal

### Phase 4: Gradual Migration (Future Phases)

**Migration Order (suggested):**

1. ✅ **Memory** (Phase 2) - Simple, representative widget
2. **Swap** - Very similar to memory, good validation of pattern
3. **CPU** - Tests multi-widget support (individual cores)
4. **Network** - Tests dynamic metric discovery (network interfaces)
5. **Disk** - Complex (pie/bar charts, mount monitoring)
6. **Battery** - Tests async initialization (proxy polling)
7. **GPU** - Tests external process integration (nvidia-smi)
8. **Thermal/Fan** - Tests sensor discovery

**After All Widgets Migrated:**

1. Remove legacy widget classes from `extension.js`
2. Remove `ElementBase`, `TipBox` classes
3. Remove `USE_MODERN_WIDGETS` feature flag
4. Clean up unused helper functions
5. Update documentation
6. Celebrate! 🎉

## Success Criteria

### Phase 1 Success Criteria

- [ ] All widget-system classes implemented and linted
- [ ] Unit tests for WidgetSettingsAdapter, WidgetRegistry
- [ ] LegacyBridge successfully wraps a mock widget
- [ ] Extension loads without errors with empty WidgetRegistry

### Phase 2 Success Criteria

- [ ] Memory widget ported to modern API
- [ ] All memory widget settings work identically to legacy version
- [ ] Visual appearance identical to legacy memory widget
- [ ] Performance (CPU, memory) equivalent to legacy
- [ ] Extension works with both modern memory widget AND all legacy widgets
- [ ] No regressions in other widgets
- [ ] Code review completed
- [ ] Documentation updated

### Long-Term Success Criteria

- [ ] All widgets migrated to modern API
- [ ] `extension.js` reduced from 2700 lines to < 500 lines
- [ ] Each widget in separate file < 150 lines
- [ ] New contributors can add custom widgets in < 50 lines
- [ ] Settings schema auto-generated from widget metadata
- [ ] 100% backward compatibility with existing user settings

## Non-Goals

**Explicitly out of scope for this task:**

- Changing user-facing behavior or appearance
- Adding new features to widgets
- Modifying settings schema structure
- Rewriting preference UI (`prefs.js`)
- Changing menu layout or structure
- Performance optimizations (unless regressions occur)
- Supporting GNOME Shell versions < 45
- Migrating GTop library to something else
- Removing or deprecating existing settings

## Risks and Mitigations

### Risk: Breaking Existing Extension

**Mitigation:**
- Feature flag (`USE_MODERN_WIDGETS`) for gradual rollout
- Legacy fallback if modern widget fails to load
- Comprehensive testing before each widget migration
- Each phase can be reverted independently

### Risk: Settings Schema Conflicts

**Mitigation:**
- Modern widgets use **exact same settings keys** as legacy
- Settings adapter maintains key prefix pattern: `{id}-{property}`
- No schema changes required during migration
- Settings migration logic (`migration.js`) unchanged

### Risk: Performance Regression

**Mitigation:**
- Profile memory widget before/after migration
- Monitor update timer precision
- Keep graph rendering code identical initially
- Add performance tests to validation checklist

### Risk: Incomplete LegacyBridge Implementation

**Mitigation:**
- Start with comprehensive interface documentation
- Test LegacyBridge with mock widget before real migration
- Verify all ElementBase methods are implemented
- Test edge cases: menu building, position sorting, theme changes

### Risk: Complex Widgets (CPU, Disk) Don't Fit API

**Mitigation:**
- Start with simple widget (Memory) to validate pattern
- Note lessons learned during Memory migration
- Allow widget API to evolve as needed
- Some widgets may require extended API surface (e.g., `collectMultiple()` for CPU cores)

## Open Questions

1. **Settings Schema Generation:** Should we auto-generate settings schema from widget metadata in future phases? (Not needed for Phase 1-2)

2. **Widget Dependencies:** How should we handle cross-widget dependencies? (e.g., Disk depending on MountsMonitor)

3. **i18n Integration:** Should widget names/labels use translation functions `_(...)` or plain strings in metadata?

4. **Error Handling:** What should happen if a widget's `collect()` throws an exception?

5. **Async Collection:** Should `collect()` support async/await for widgets that need to query external processes?

6. **Custom Rendering:** Should widgets be able to provide custom rendering logic for complex UIs (e.g., pie charts)?

7. **Widget Metadata Validation:** Should we enforce metadata schema with JSON Schema validator or just runtime checks?

## Timeline Considerations

**Note:** Per project guidelines, we do not provide time estimates. The phases above represent logical ordering and dependencies, not temporal scheduling.

Each phase can be implemented independently and should be considered complete only when all success criteria are met. The user decides when to move from one phase to the next.

## Next Steps

1. **Review this document** - Iterate on architecture decisions and requirements
2. **Approve Phase 1 scope** - Confirm widget system foundation design
3. **Begin implementation** - Start with Phase 1.1 (directory structure)
4. **Iterative development** - Implement, test, review each component
5. **Phase 1 completion review** - Validate foundation before widget migration
6. **Proceed to Phase 2** - Begin memory widget migration

---

**Document Version:** 1.0
**Last Updated:** 2026-01-08
**Author:** Planning Phase
**Status:** Draft - Awaiting Review
