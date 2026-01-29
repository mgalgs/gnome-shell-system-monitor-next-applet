# Implementation Plan (Widget Architecture Modernization)

Status key: [NOT STARTED] / [IN PROGRESS] / [DONE]

## Completed

- [DONE] Widget System Foundation
  - All core modules exist in `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/`
  - Extension works with zero new widgets registered

- [DONE] Memory Widget Migration
  - Memory widget migrated to new architecture
  - Integration complete via `_createMemoryWidget()` in extension.js
  - All other widgets remain legacy and unaffected

## Code Review Feedback Addressed

- [NOT STARTED] Track which code review feedback items have been resolved

## Remaining Work

### Critical Bugs

- [NOT STARTED] Fix `imports.gi.Cogl` usage in WidgetRenderer breaking ES module semantics (WidgetRenderer.js:~60)
- [NOT STARTED] Fix Tooltip creation duplication between LegacyBridge.tip_format and WidgetRenderer.tip_format
- [NOT STARTED] Fix LegacyBridge.update not calling scheduler; collect() frequency differs from legacy Mem (LegacyBridge.js:~680)
- [NOT STARTED] Fix chart scale cooldown logic duplication between ElementBase and LegacyBridge branches

### Correctness & Edge Cases

- [NOT STARTED] Determine and implement correct GiB rounding for MemoryWidget parity with legacy Mem (memory-widget.js:~50-85)
- [NOT STARTED] Resolve Memory total normalization differences for >4GiB systems
- [NOT STARTED] Fix menu rebuilding for modern widgets not triggered by show-menu changes
- [NOT STARTED] Fix setChart not updating chart colors or hooking repaint signals after schema change
- [NOT STARTED] Fix WidgetRenderer._importExtension using global imports path instead of extension scope
- [NOT STARTED] Fix Scheduler instantiated but never used in _createMemoryWidget (dead code)
- [NOT STARTED] Fix Renderer.apply and LegacyBridge._updateMenuItems duplicating logic with differing rules

### Performance

- [NOT STARTED] Optimize LegacyBridge.update to batch processing instead of running all per-frame

### Architecture & Maintainability

- [NOT STARTED] Extract helper functions from LegacyBridge (>800 lines):
  - Tooltip helper
  - Color parsing helper
  - Chart adapter
- [NOT STARTED] Consider unifying data pipeline between WidgetRenderer and LegacyBridge to avoid parity drift (40-60% code duplication)
- [NOT STARTED] Use extension-provided color parsing instead of ad-hoc Cogl imports
- [NOT STARTED] Remove dead parameters renderer/scheduler in WidgetRegistry.create or wire scheduler through LegacyBridge

### Testing (Incremental)

- [NOT STARTED] Set up testing infrastructure starting with widget system
- [NOT STARTED] Unit tests for MemoryWidget.collect to ensure legacy parity:
  - MiB/GiB boundaries
  - rounding
  - buffer/cache semantics
- [NOT STARTED] Test LegacyBridge.update to ensure identical text/menu outputs to legacy Mem for same sample data
- [NOT STARTED] Test tooltip content parity between legacy and modern implementations

### Foundation Improvements

- [NOT STARTED] Documentation & Specs
  - Establish specs as single source of truth under `ai/specs/`
  - Define minimal runtime integration contract
  - Document widget API, data flow, and lifecycle
  - Document LegacyBridge contract
  - Document settings compatibility rules
  - Create verification checklist with step-by-step checks

- [NOT STARTED] Terminology Cleanup
  - Remove "modern" terminology from all code and comments
  - Use consistent naming ("new" widget system, "legacy" widgets)

- [NOT STARTED] ESLint Configuration Migration
  - Migrate `.eslintrc` to `eslint.config.js` (ESLint v9 format)
  - Fix all eslint violations in codebase

- [NOT STARTED] Build System Improvements
  - Add `make check` target combining whitespace + eslint checks
  - Update existing `checkjs.sh` or integrate into Makefile

- [NOT STARTED] Future Widget Migrations (Post-Memory)
  - CPU widget migration
  - Disk widget migration
  - Network widget migration
  - GPU widget migration
  - Battery widget migration
  - Temperature widget migration

## Migration Priority

1. Critical bugs (Cogl imports, tooltip duplication, scheduler issues, chart scaling)
2. Correctness & edge cases (rounding parity, normalization, menu rebuilding, setChart colors, imports scope, dead code)
3. Architecture & maintainability (extract helpers, unify data pipeline, color parsing, remove dead params)
4. Foundation improvements (docs, terminology cleanup, ESLint config, build system)
5. Testing infrastructure and specific parity tests
6. Future widget migrations (one at a time)
