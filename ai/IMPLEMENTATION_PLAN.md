# Implementation Plan (Widget Architecture Modernization)

Status key: [NOT STARTED] / [IN PROGRESS] / [DONE]

- [NOT STARTED] Establish specs as the single source of truth under `ai/specs/`
  - Done when:
    - `ai/specs/` exists and contains the accepted architecture + migration contracts
    - New widget-system decisions are documented in `ai/specs/` (not only in `ai/PRD.md` / `ai/TASK_*.md`)

- [NOT STARTED] Define the minimal runtime integration contract (how modern widgets wire into the existing monolith)
  - Done when:
    - `ai/specs/02-runtime-integration-contract.md` identifies the exact hook points in `system-monitor-next@paradoxxx.zero.gmail.com/extension.js`
    - Contract is explicitly “Memory first; everything else legacy”; includes lifecycle + cleanup rules

- [NOT STARTED] Specify the modern widget API + data flow (Memory-first)
  - Done when:
    - `ai/specs/03-widget-system-architecture.md` defines:
      - widget lifecycle (`initialize`/`collect`/`destroy`), sync + async
      - metric/series model (multi-metric widgets)
      - renderer responsibilities (digit/graph/both) without changing user-visible behavior
      - scheduler responsibilities (interval, error handling, continuation)

- [NOT STARTED] Specify `LegacyBridge` (modern -> legacy interface adapter)
  - Done when:
    - `ai/specs/04-legacy-bridge-contract.md` documents the legacy surface the monolith expects (at minimum: `actor`, `update()`, `destroy()`, menu/text item creation expectations)
    - Failure modes are defined (collect throws, async collect, disabled widget) and must not take down the extension

- [NOT STARTED] Specify Memory widget parity requirements and migration boundaries
  - Done when:
    - `ai/specs/05-memory-widget-migration.md` defines what “identical” means for Memory:
      - panel display, menu row, tooltip values, units, and settings behavior
      - uses the same existing GSettings keys (`memory-*`)
      - no changes to `prefs.js` or schemas required

- [NOT STARTED] Specify settings compatibility rules (no schema redesign)
  - Done when:
    - `ai/specs/06-settings-compat.md` defines:
      - key prefixing rule (`{id}-{property}`)
      - which settings are “framework-owned” (display/style/refresh/width/colors/show-menu/show-text)
      - required behavior when settings change at runtime

- [NOT STARTED] Define verification checklist (lint/build/gui smoke)
  - Done when:
    - `ai/specs/07-verification.md` exists with step-by-step checks and pass/fail criteria
    - Includes the repo’s existing tools (`./checkjs.sh`, `make build`, `test.sh`/GUI tests where applicable)

- [NOT STARTED] Implement widget-system foundation modules (code)
  - Done when:
    - `system-monitor-next@paradoxxx.zero.gmail.com/widget-system/` exists with the modules defined in specs
    - Extension still works with zero modern widgets registered

- [NOT STARTED] Migrate exactly one widget: Memory (code)
  - Done when:
    - `memory` is created via registry + `LegacyBridge` (or equivalent) and is parity-complete per spec
    - All other widgets remain legacy and unaffected
