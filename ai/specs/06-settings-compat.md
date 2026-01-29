# Settings Compatibility Rules

## Key Prefix

- Widget id is the prefix.
- Setting keys are `{id}-{property}`.

## Framework-Owned Standard Keys

The modern framework must support the existing keys used by `ElementBase`:

- `{id}-display`
- `{id}-show-text`
- `{id}-show-menu`
- `{id}-style` (`digit` / `graph` / `both`)
- `{id}-refresh-time`
- `{id}-graph-width`
- `{id}-{metric}-color` (for each series color)

## Runtime Change Handling

- When `{id}-refresh-time` changes: update scheduling interval.
- When `{id}-style` changes: update visible subactors (digit/graph/both).
- When `{id}-graph-width` changes: resize graph.
- When color changes: repaint.
- When `{id}-display` or `{id}-show-menu` change: update visibility and menu rebuild behavior consistent with current `build_menu_info` semantics.
