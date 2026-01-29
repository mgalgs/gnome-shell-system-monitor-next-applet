# Human input

- Don't refer to the new widget system as "modern" in the code, comments, or messages. The word "modern" should not be used. It needs to be removed. Exception: it's okay to leave in design/planning documents (anything under `ai/`).

- We need to add checks for whitespace issues (no trailing whitespace, etc). Perhaps a `make check` target that also does the eslint step and whatever else you recommend?

- There are quite a few eslint failures to fix. `make check` will help identify them. Only run eslint on the new widgets system and new widgets (don't worry about legacy code formatting -- fixing all of those will make the diff too large).

- We have both .eslintrc and eslint.config.js.

- What about testing? What do you recommend? Can we add testing incrementally, starting with the new widget system (not adding tests for legacy code)? What are the main canonical options for testing a Gnome Shell extension?

- The units stuff in memory-widget.js is a little unfortunate. Can we come up with something cleaner? Like maybe the widget `collect()` returns base units and the framework takes care of humanizing the values (using the appropriate unit for the value). Might need a way to specify what kind of value it is (e.g. "bytes", "bytes/second", "%", etc).

- The requirement for filling out the _normalized field is also a little too low-level. Widget authors shouldn't have to do normalization, that should be handled in the framework layer.

In general I'm just not really impressed with how memory-widget.js looks. It doesn't make it look simple and straightforward to define my own widget (which is the ultimate goal).

# Code Review Feedback

Please address the below code review feedback, pushing back on any invalid feedback or requesting clarification from the human for subjective decisions.

> # TL;DR: [ISSUE] Overall architecture looks solid, but Memory-widget parity has
> # several correctness gaps and LegacyBridge has multiple brittle behaviors that
> # will cause regressions. No security issues found.
> # 
> # Details:
> # - Security:
> #   - None
> # 
> # - Bugs:
> #   - LegacyBridge.update does not call scheduler; collect() frequency differs
> #     from legacy Mem (line ~680 in LegacyBridge.js).
> #   - Renderer.apply and LegacyBridge._updateMenuItems duplicate logic with
> #     differing rules; text/menu values will diverge (multiple locations).
> #   - Using `imports.gi.Cogl` inside WidgetRenderer breaks ES module semantics and
> #     will fail on GNOME Shell 45+ (WidgetRenderer.js: ~60).
> #   - Tooltip creation duplicated between LegacyBridge.tip_format and
> #     WidgetRenderer.tip_format; both write to tipmenu inconsistently.
> #   - MemoryWidget: GiB rounding differs from legacy Mem; parity mismatch
> #     (memory-widget.js: ~50-85). (TBD: which one is more correct?)
> #   - Chart scale cooldown logic duplicated in both ElementBase and LegacyBridge
> #     branches; Memory (modern) vs others (legacy) will diverge (extension.js +
> #     LegacyBridge.js). Maybe this is okay given that the goal is to migrate
> #     all widgets to the new framework.
> # 
> # - Correctness & Edge Cases:
> #   - Memory total normalization uses gtop.total but legacy calculation differs
> #     in rounding; graphs will not match legacy for >4GiB systems. Which one is
> #     more correct?
> #   - Menu rebuilding for modern widgets not triggered by show-menu changes
> #     (LegacyBridge._onMenuVisibilityChanged is stubbed).
> #   - Chart replacement via setChart does not update chart colors or hook repaint
> #     signals; memory graph may display wrong colors after schema change.
> #   - WidgetRenderer._importExtension uses global imports path, not extension
> #     scope; violates modularity assumptions.
> #   - Scheduler is instantiated but never used in _createMemoryWidget; dead code.
> # 
> # - Performance:
> #   - LegacyBridge.update runs all processing per frame without batching; CPU
> #     frequency similar to legacy but more allocations; can be optimized.
> #   - Polling loop in Battery widget is fine; no regression risk.
> # 
> # - Tests:
> #   - Suggested test updates:
> #     - Unit tests for MemoryWidget.collect to ensure legacy parity for:
> #       - MiB/GiB boundaries
> #       - rounding
> #       - buffer/cache semantics
> #     - Test LegacyBridge.update to ensure identical text/menu outputs to legacy
> #       Mem for same sample data.
> #     - Test tooltip content parity.
> # 
> # - Maintainability/Style:
> #   - LegacyBridge is >800 lines and mixes rendering, settings, tooltip, and
> #     scaling logic; strongly recommend extracting:
> #     - Tooltip helper
> #     - Color parsing helper
> #     - Chart adapter
> #   - WidgetRenderer duplicates 40-60% of LegacyBridge logic; consider unifying
> #     data pipeline to avoid parity drift.
> #   - Use extension-provided color parsing instead of ad-hoc Cogl imports.
> #   - Remove dead parameters renderer/scheduler in WidgetRegistry.create or
> #     actually wire scheduler through LegacyBridge.

These need to be extracted out into separate action items in the IMPLEMENTATION_PLAN.md.
