# Runtime Integration Contract (Minimal Changes)

## Baseline

- Runtime entrypoint: `system-monitor-next@paradoxxx.zero.gmail.com/extension.js` (`SystemMonitorExtension.enable()` / `.disable()`).
- Widget base: `ElementBase` (builds `actor`, label/text, `Chart`, settings wiring, update timer).
- Assembly: hardcoded `positionList[<position>] = new Mem(this)` and final `this.__sm.elts = sortedPLValues.flat()`.

## Objective

Introduce a modern widget system with the smallest possible change surface to `extension.js` while allowing legacy widgets to remain untouched.

## Required Hook Points

1. Widget construction in `SystemMonitorExtension.enable()`
   - Only the Memory widget creation path must be replaceable.
   - The existing `positionList` -> `Object.entries().sort()` -> `.flat()` pipeline remains.

2. Lifecycle
   - Modern widgets must be started during `enable()` and stopped/cleaned during `disable()`.
   - Modern widgets must not leak GLib timeouts, signal handlers, or actors.

3. Failure containment
   - A modern widget failure must not prevent the extension from enabling.
   - A modern widget `collect()` exception must be logged and must not permanently stop updates.

## Dual Operation

- The extension must work with zero modern widgets registered.
- The extension must support a mix:
  - Memory via modern system
  - all other widgets via legacy code

## Backward Compatibility Constraints

- Modern Memory must use the same settings keys as legacy Memory (`memory-*`).
- No changes to `prefs.js` behavior.
- No changes to `schemas/org.gnome.shell.extensions.system-monitor-next-applet.gschema.xml` are required for the initial migration.
