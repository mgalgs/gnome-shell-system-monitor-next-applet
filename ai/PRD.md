# Product Requirements Document (PRD): Incremental Widget Architecture Modernization

## Context

The GNOME Shell System Monitor extension’s widget implementations live primarily in a monolithic `system-monitor-next@paradoxxx.zero.gmail.com/extension.js` (~2700 lines). Widgets (CPU, memory, disk, network, etc.) are implemented as classes extending a legacy base (`ElementBase`) and are tightly coupled to an extension singleton for settings, styling, and runtime behavior.

We want to improve developer experience (DevEx) and provide a better framework for widget implementations without rewriting the entire application. The new architecture must be wired into the existing implementation with minimal disruption so widgets can migrate incrementally.

## Problem Statement

Developing and maintaining widgets is slow and error-prone due to:
- Tight coupling to the extension singleton and implicit contracts
- High boilerplate per widget (settings wiring, UI/menu item creation, timers)
- Mixed concerns (data collection, rendering, settings, scheduling in one place)
- Large monolithic file makes navigation and review difficult
- Poor testability (requires GNOME Shell runtime and full extension instance)

## Goals

- Introduce a modular widget system (plugin-like) alongside the legacy system
- Provide a simple modern widget API focused primarily on data collection
- Keep user-facing behavior and settings fully backward compatible
- Enable incremental migration: migrate widgets one-by-one, based on need
- Reduce per-widget boilerplate and make it easier to add new features in the modern framework

## Non-Goals

- No user-facing UI/behavior changes (panel/menu layout, visual style, labels)
- No settings schema redesign or preferences UI rewrite (`prefs.js` remains as-is)
- No attempt to optimize performance beyond avoiding regressions
- No support for GNOME Shell versions < 45

## Personas

- Extension maintainers: need safer refactors, faster iteration, clearer code boundaries
- Contributors: want to add or modify widgets without understanding the entire `extension.js`
- End users: expect identical behavior, stable updates, preserved settings

## Proposed Solution

Introduce a new `widget-system/` that owns cross-cutting concerns (settings, rendering, scheduling, lifecycle) and exposes a small base class for widget authors.

### Modern Widget Authoring Model

Widget authors implement:
- `initialize()` (optional one-time setup)
- `collect()` (required periodic data collection)
- `destroy()` (optional cleanup)

Widget authors declare `static metadata` describing:
- `id` (also the settings key prefix)
- user-visible `name`/`description`
- `metrics[]` (series keys, labels, default colors, units)
- optional widget-specific settings metadata

### Incremental Migration via Compatibility Bridge

The extension must support legacy and modern widgets concurrently.

- Modern widgets are wrapped by a `LegacyBridge` that exposes the legacy `ElementBase`-like interface expected by current extension code
- Existing widget management logic (positioning, menu building, sorting, lifecycle) should require minimal changes
- A feature flag or availability check determines whether a modern widget is used, with a fallback to legacy

## Scope

### In Scope (This Project)

1. Implement the widget-system foundation:
   - `Widget` base class
   - `WidgetRegistry` (register/load/create)
   - `WidgetSettingsAdapter` (type-safe prefixed settings access)
   - `WidgetRenderer` (status labels, menu rows, graph integration)
   - `WidgetScheduler` (update timers, error handling)
   - `LegacyBridge` (modern → legacy interface compatibility)

2. Migrate exactly one widget end-to-end to validate the system:
   - First migration target: Memory widget (legacy `Mem` parity)

3. Add developer documentation sufficient to migrate additional widgets incrementally.

### Out of Scope (Explicit)

- Migrating additional widgets beyond Memory
- Auto-generating GSettings schemas from widget metadata (future work)
- Introducing new widget features
- Refactoring `prefs.js`

## Requirements

### Functional Requirements

1. Dual operation (legacy + modern)
   - The extension loads and functions with zero modern widgets registered
   - The extension can run with a mix of legacy and modern widgets

2. Backward compatibility
   - Modern widgets must use the same GSettings keys as legacy widgets (prefix pattern `{id}-...`)
   - Existing user settings continue to work unchanged
   - The memory widget looks and behaves identically to its legacy counterpart

3. Minimal integration changes
   - Existing panel/menu assembly logic remains largely unchanged
   - Modern widgets integrate through `LegacyBridge` to meet the legacy contract

4. Widget API
   - Supports multiple metrics per widget
   - Supports current display modes (digit / graph / both) through the renderer
   - Supports existing per-widget toggles (show/hide in panel/menu) via settings

5. Scheduling
   - Refresh interval driven by existing per-widget refresh settings
   - Failures in `collect()` are logged and do not permanently stop the extension

6. Rendering
   - Auto-creates status bar labels, menu items, tooltips, and graphs based on metadata
   - Color updates reflect existing settings and theme behavior as today

7. Internationalization
   - Widget metadata strings are i18n-ready (`_(...)`)

8. Async
   - `collect()` supports async for widgets requiring external commands/processes

### Non-Functional Requirements

- Performance: no meaningful regression in CPU usage, allocations, or update cadence vs legacy
- Reliability: enable/disable cycles work; no leaks from timers/signals
- Maintainability: clear module boundaries; widget files are small and self-contained
- Testability: core non-GNOME logic (registry/settings adapter) is structured to be unit-testable

## Migration Plan

### Phase 1: Widget System Foundation

- Add `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/` with the core modules
- Add a registry entrypoint to register modern widgets
- Integrate safely: extension continues to work even if no modern widgets are available

Acceptance criteria:
- Extension loads normally with legacy widgets
- Registry and settings adapter can be instantiated without GNOME UI elements
- `LegacyBridge` can wrap a mock modern widget and satisfy the expected legacy calls

### Phase 2: Memory Widget Migration

- Implement `system-monitor-next@paradoxxx.zero.gmail.com/widgets/memory-widget.js` using the modern API
- Wire memory creation through: `Registry.create('memory')` → `LegacyBridge.wrap(...)`

Acceptance criteria:
- Memory widget parity: same data, same display, same menu/tooltips, same update rate
- All memory-related settings behave as before
- Other widgets remain unchanged and unaffected

### Phase 3: Documentation

- Add developer documentation for:
  - Modern widget API and metadata schema
  - Migration checklist (legacy → modern)
  - Testing guidance for parity and regressions

## User Stories

### Developer

- As a contributor, I can add a new widget by implementing `collect()` and defining metadata, without writing panel/menu boilerplate
- As a maintainer, I can migrate a widget incrementally and ship it without breaking other widgets
- As a maintainer, I can keep existing settings stable while evolving internal architecture

### End User

- As a user, my existing settings continue to work after modernization
- As a user, the memory widget behaves the same before and after migration

## Success Metrics

- Reduced boilerplate for new widgets (qualitative: fewer required methods and less per-widget wiring)
- Memory widget migrated with zero behavior regressions
- Extension supports mixed legacy/modern operation
- `extension.js` becomes incrementally smaller over time as more widgets migrate (long-term)

## Risks and Mitigations

- Risk: breaking extension runtime
  - Mitigation: dual-mode operation, incremental rollout

- Risk: legacy contract mismatch in `LegacyBridge`
  - Mitigation: document expected legacy interface; validate with mock widget before real migration

- Risk: performance regressions
  - Mitigation: keep graph rendering behavior initially equivalent; validate update cadence; monitor logs

- Risk: complex widgets don’t fit the initial modern API
  - Mitigation: start with Memory; allow API to evolve carefully as later migrations require

## Open Questions (Deferred Decisions)

- How should custom rendering be supported for non-standard widgets (e.g., disk pie charts)?
