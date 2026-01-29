# LegacyBridge Contract (Modern -> Legacy Surface)

## Purpose

Allow modern widgets to be integrated into the existing monolithic code path that expects `ElementBase`-like objects.

## Minimum Legacy Surface Required

The bridged object must be usable wherever `ElementBase` subclasses are used today:

- `actor`: the top-level `Clutter.Actor` added to the panel box
- `menu_visible`: boolean respected by `build_menu_info(extension)`
- `item_name`: label used in the menu table
- `create_menu_items()`: returns `St.Label[]` (or actors) attached into the menu table
- `create_text_items()`: returns `St.Label[]` (or actors) attached into the panel widget
- `update()`: called by the scheduler / timer; must return `GLib.SOURCE_CONTINUE` semantics when driven by GLib timeouts
- `destroy()`: must remove timers/signals and destroy actors

## Compatibility Rules

- Must respect the same settings keys as the legacy widget.
- Must not require changes to `build_menu_info(extension)` or the menu table wiring.
- Must integrate cleanly with `SystemMonitorExtension.disable()` teardown.

## Failure Modes

- If `collect()` throws/rejects: log and keep scheduling.
- If a widget is disabled via settings (`{id}-display` and `{id}-show-menu` both false): updates may be skipped, consistent with current legacy behavior.
