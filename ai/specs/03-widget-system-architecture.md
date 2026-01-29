# Widget System Architecture (Memory-First)

## High-Level Design

Add a new runtime subsystem under `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/` that owns:

- registry (what widgets exist)
- settings adapter (prefixed GSettings access)
- scheduler (update cadence, error handling)
- renderer (standard digit/graph/both UI surfaces)

Modern widgets focus primarily on data collection and declare metadata.

## Widget Author API

Each modern widget:

- declares `static metadata`:
  - `id` (must match legacy settings prefix, e.g. `memory`)
  - `name` (i18n-ready)
  - `metrics[]` describing series keys and labels; default colors must map to existing color settings keys
- implements:
  - `initialize()` optional (one-time setup)
  - `collect()` required (may be async)
  - `destroy()` optional

## Data Model

- `collect()` returns an object keyed by metric keys, plus any internal fields needed by the renderer.
- Multi-metric widgets are supported (Memory has `program`, `buffer`, `cache`).

## Scheduling

- Interval is driven by the existing per-widget refresh setting: `{id}-refresh-time`.
- Scheduler rules:
  - on error: log; continue scheduling
  - supports async `collect()` (await completion; do not overlap runs unless explicitly required)

## Rendering

- Must support existing per-widget display modes (digit/graph/both) via `{id}-style`.
- Must support:
  - `{id}-display` (panel visibility)
  - `{id}-show-menu` (menu visibility)
  - `{id}-show-text` (label visibility)
  - `{id}-graph-width` and existing compact mode behavior
  - existing color keys (`{id}-{color_name}-color`)

The initial implementation may reuse existing rendering primitives (`Chart`) to minimize risk, but the ownership and wiring must be explicit and spec’d.
