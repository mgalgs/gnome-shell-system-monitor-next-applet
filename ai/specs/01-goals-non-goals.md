# Goals and Non-Goals

## Context

Runtime widget implementations are primarily in `system-monitor-next@paradoxxx.zero.gmail.com/extension.js`. Widgets are currently `ElementBase` subclasses created in `SystemMonitorExtension.enable()` via a hardcoded `positionList` (e.g. `new Mem(this)`).

## Goals

- Improve developer experience by introducing a modular widget authoring model.
- Keep user-facing behavior and settings backward compatible.
- Support dual operation: legacy widgets and modern widgets concurrently.
- Enable incremental migration: migrate widgets one-by-one (first target: Memory).
- Reduce per-widget boilerplate by centralizing scheduling, settings access, and standard rendering.

## Non-Goals

- No settings schema redesign; no preference UI rewrite (`prefs.js` stays as-is).
- No user-facing visual/layout changes.
- No performance optimization work beyond avoiding regressions.
- No support for GNOME Shell versions < 45.
- No mass refactor of `extension.js` into multiple files in one go.
