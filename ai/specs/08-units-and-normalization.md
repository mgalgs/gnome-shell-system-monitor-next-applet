# Units and Normalization (Framework-Owned)

This spec defines the intended data contract between widgets and the widget system for values, unit selection/humanization, and normalization for graphs.

It exists to improve widget author DevEx by removing per-widget boilerplate around:

- choosing display units (MiB vs GiB, KiB/s vs MiB/s, etc.)
- formatting values for panel/menu (locale, rounding)
- producing normalized series values for graphs

## Goals

- Widget authors can implement `collect()` in base units (e.g. bytes) and return a small, obvious object.
- The framework computes:
  - display strings for text/menu/tooltips
  - normalized series values for charts
- Memory widget matches legacy behavior exactly (formatting, unit threshold, rounding).

## Non-Goals

- Changing existing settings keys or preferences UI.
- Introducing new user-visible output.

## Data Contract

### Widget returns base units

`collect()` returns a plain object with numeric values keyed by metric keys. Values are in base units defined by metadata.

Example (memory):

```js
return {
  program: programBytes,
  buffer: bufferBytes,
  cache: cacheBytes,
  total: totalBytes,
};
```

Notes:

- Widgets should not be required to return `_normalized`.
- Widgets should not be required to decide “MiB vs GiB”.

### Framework computes derived fields

The framework derives, at minimum:

- `normalized[metricKey]`: a 0..1 value for charting
- `display` strings for the panel/menu/tooltips

For memory parity with legacy `Mem`, the framework must treat:

- **total**: from `data.total` (bytes)
- **used for menu absolute**: `program` only (matches legacy `Mem._apply()`)

## Metadata additions

Widgets declare the unit kind for each metric via metadata. Initial kinds:

- `bytes`
- `bytes-per-second`
- `percent`
- `count` (unitless integer)

This spec does not require schema changes; it only affects how the framework formats values.

## Memory-specific formatting rules (legacy parity)

The framework’s bytes formatter must match legacy `Mem` behavior:

- Choose MiB vs GiB using threshold: `totalMiB > 4096`.
- MiB display: integer MiB (rounded from bytes) with locale formatting.
- GiB display: value rounded to 2 decimals via the legacy `*100` mechanism:
  - compute `GiB * 100`, round to integer, then divide by `100`.
- GiB string formatting:
  - if value < 1: exactly 2 fraction digits
  - else: 3 significant digits
- Unit label is localized: `_('MiB')` / `_('GiB')`.

Normalization for charts/percent values must be computed from the same rounded display-domain values as legacy:

- Convert program/buffer/cache/total to display-domain numeric values (MiB or GiB) first.
- Then compute `normalized[key] = value / total`.

## Open Questions

- Should “primary metric” (the one shown in the panel percent) be explicit metadata (e.g. `primaryKey`) rather than “first metric wins”? Memory is currently “program”.
- Should `total` be a reserved key in `collect()` results (recommended), or should it be configurable (e.g. `metadata.totalKey`)?
