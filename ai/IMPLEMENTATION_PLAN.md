# Implementation Plan (Widget Architecture Modernization)

Status key: [NOT STARTED] / [IN PROGRESS] / [DONE]

This plan is prioritized by risk (runtime breakage/parity regressions first), then DevEx improvements (lint/test tooling) while keeping changes scoped to the widget system + migrated widgets only.

## Current State (Validated in Working Tree)

- [DONE] Core widget-system modules exist under `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/`.
- [DONE] Memory widget exists under `system-monitor-next@paradoxxx.zero.gmail.com/widgets/memory-widget.js` and is wired via `SystemMonitorExtension._createMemoryWidget()`.
- [NOT STARTED] Build packaging includes widget-system + widgets in `_build/` (Makefile currently omits these paths).

## Highest Priority Remaining Work

### P0: Correctness / Runtime Safety (Must Fix For Parity)

- [NOT STARTED] Fix menu rebuild compatibility for bridged widgets
  - `build_menu_info()` destroys menu actors and expects `create_menu_items()` to return fresh actors; LegacyBridge currently returns persistent actors that may already be destroyed.
  - Ensure `{id}-show-menu` changes trigger the same rebuild behavior as legacy `change_menu()`.

- [NOT STARTED] Fix settings signal lifecycle leaks for widget-system
  - LegacyBridge connects directly to `extension._Schema` in multiple places but does not store/disconnect signal IDs on destroy.
  - WidgetRenderer also connects to schema changes without a corresponding disconnect/destroy path.

- [NOT STARTED] Fix async `collect()` handling and failure containment
  - LegacyBridge calls `widget.collect()` synchronously and does not await promises; rejected promises can become unhandled.
  - Ensure `collect()` errors (throw/reject) are logged and updates continue.

- [NOT STARTED] Fix tooltip implementation duplication / broken renderer tooltip path
  - Tooltip UI classes exist in both `extension.js` and `widget-system/LegacyBridge.js`.
  - `WidgetRenderer._importTipMenu()` is effectively a placeholder and will break if used.
  - Decide a single owner for tooltip creation and content updates (Bridge vs Renderer) and remove the duplicate path.

### P0: Memory Parity Gaps (Visible Output Differences)

- [NOT STARTED] Fix Memory menu “used / total” semantics
  - Legacy Mem shows `program / total` (user only); widget-system currently sums program+buffer+cache.

- [NOT STARTED] Fix unit label localization in widget-system menu output
  - Legacy Mem uses `_('MiB')` / `_('GiB')`; widget-system currently hardcodes `'MiB'/'GiB'`.

- [NOT STARTED] Align Memory normalization/percentage math with legacy rounding
  - Legacy computes percentages from already-rounded MiB/GiB values; current MemoryWidget normalizes from raw bytes.

### P0: Build/Install Safety

- [NOT STARTED] Update build packaging to include new code
  - Ensure `make build`, `make install`, and `make zip-file` include:
    - `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/**`
    - `system-monitor-next@paradoxxx.zero.gmail.com/widgets/**`

## DevEx Improvements (Scoped To New Code)

### Linting

- [NOT STARTED] Scope ESLint to widget-system + widgets only
  - Update `make check.lint` and `checkjs.sh` to lint only:
    - `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/`
    - `system-monitor-next@paradoxxx.zero.gmail.com/widgets/`
  - Do not reformat or fix lint in legacy `extension.js` as part of this project.

### Testing (Incremental, New Code Only)

- [NOT STARTED] Add a minimal GJS unit-test harness for widget-system
  - Start with tests that avoid requiring a full GNOME Shell session (registry/settings/small pure helpers).

- [NOT STARTED] Add MemoryWidget parity tests (fixture-based)
  - Encode boundary/rounding cases (MiB/GiB threshold, rounding, buffer/cache semantics).
  - Prefer injecting a stats provider so tests don’t depend on host libgtop values.

### Data Model / API Cleanup (DevEx)

- [NOT STARTED] Update widget-system data contract so widget authors don’t implement normalization/unit selection
  - Replace the “widget must return `_normalized`” expectation with framework-owned normalization.
  - Add a framework-owned value formatting layer (bytes/bytes-per-second/percent/etc.) so `collect()` can return base units and the framework humanizes for display.

## Maintainability (After Parity)

- [NOT STARTED] Reduce duplication between LegacyBridge and WidgetRenderer
  - Consolidate: normalization, tooltip content update, percent + used/total formatting, and color parsing into shared helpers.
  - Pick a single pipeline for text/menu/tooltip updates to avoid drift.

- [NOT STARTED] Decide scheduler ownership and simplify
  - Either (a) wire WidgetScheduler through LegacyBridge, or (b) remove WidgetScheduler for now and make LegacyBridge fully handle async+error rules.

## Documentation (Planning / Source of Truth)

- [DONE] `ai/specs/*` exist and define core contracts and verification checklist.
- [NOT STARTED] Add a spec for framework-owned units/humanization + normalization contract.

## Out of Scope (For This Project)

- Migrating additional widgets beyond Memory.
- Refactoring `prefs.js`.
- Mass refactors of legacy `extension.js` beyond the minimal integration hook(s).
