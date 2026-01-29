# Memory Widget Migration (Parity Contract)

## Baseline Behavior (Legacy)

Legacy Memory is implemented by `Mem` in `system-monitor-next@paradoxxx.zero.gmail.com/extension.js` and:

- reads `GTop.glibtop_get_mem()`
- computes `mem = [user, buffer, cached]` and `total`
- graph values are normalized (`mem[i] / total`)
- tooltip values are percentages per series
- text shows a single percentage and the menu shows both percent + absolute used/total with unit (`MiB`/`GiB`)

## Migration Definition

Memory is considered “migrated” when:

- `enable()` constructs Memory via the modern widget system and integrates it into `positionList` without changing the rest of widget assembly.
- the modern Memory uses existing settings keys (`memory-*`) and respects live updates.
- user-visible output matches the legacy widget’s:
  - panel label/value formatting
  - tooltip series and values
  - menu row values and units
  - update cadence

## Out of Scope for Memory Migration

- Any changes to the schema XML or `prefs.js`.
- Any changes to other widgets.
- Any behavior changes (new fields, new menu rows, new units).
