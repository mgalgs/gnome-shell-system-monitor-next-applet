# Verification Checklist

## Lint

- Run `./checkjs.sh` and ensure no new violations introduced by modernization work.

## Build

- Run `make build`.

## GUI Smoke / Regression

Manual or CI-driven checks (where possible):

- Extension enables successfully.
- Memory appears in the panel and menu with expected values.
- Memory respects: `memory-display`, `memory-show-menu`, `memory-show-text`, `memory-style`, `memory-refresh-time`, `memory-graph-width`, color changes.
- Disable/enable cycle does not duplicate actors or leave stale timers.
- Other widgets still function unchanged (CPU, Net, Disk, etc.).

## Existing GUI Test Harness

- Ignore the repo’s docker GUI tests, they are obsolete (and will be removed separately).
