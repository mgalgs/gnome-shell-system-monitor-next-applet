# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A GNOME Shell extension that displays system resource usage (CPU, memory, disk, network, GPU, battery) in the top panel. This is a fork of paradoxxxzero/gnome-shell-system-monitor-applet, now actively maintained.

**Extension UUID:** `system-monitor-next@paradoxxx.zero.gmail.com`

**Supported GNOME Shell versions:** 45, 46, 47, 48, 49

## Prerequisites

The extension requires system libraries to function:
- `libgtop` (system metrics)
- `NetworkManager` libraries (network monitoring)
- `clutter` (rendering)
- `gnome-system-monitor`
- For NVIDIA GPU monitoring: `nvidia-smi`
- For Wayland development on GNOME Shell 49+: `mutter-devkit`

## Build and Development Commands

### Installation and Building

```bash
# Install the extension locally (builds, installs, compiles schemas)
make install

# Uninstall the extension
make uninstall

# Build without installing (creates _build/ directory)
make build

# Clean build artifacts
make clean

# Create distribution zip for extensions.gnome.org
make zip-file
```

### Development Workflow

After making changes to the extension code:

```bash
# Reinstall
make install
```

Then reload GNOME Shell:
- **X11:** Press `Alt+F2`, type `r`, press Enter (or use `./reload-gs.sh`)
- **Wayland:** Log out and log back in (or use nested session - see below)

### Wayland Nested Session (for faster iteration)

GNOME Shell 49+:
```bash
dbus-run-session -- gnome-shell --devkit
```

Pre-GNOME Shell 49:
```bash
dbus-run-session -- gnome-shell --nested --wayland
```

After starting the nested session, open a terminal **inside** it and enable the extension:
```bash
gnome-extensions enable system-monitor-next@paradoxxx.zero.gmail.com
```

To capture debug logs with custom screen size:
```bash
G_MESSAGES_DEBUG=all MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768 dbus-run-session -- gnome-shell --nested --wayland |& tee /tmp/logs.txt
```

### Linting

```bash
# Run ESLint
npm run lint
```

ESLint configuration is in `eslint.config.js` (flat config format, ES2022, 4-space indent, single quotes, max line length 160).

### VM-Based Functional Testing

Automated testing in an isolated VM with a real GNOME Shell session. Requires `libvirt`, `virt-install`, `qemu-img`, `genisoimage`, and `ImageMagick`.

```bash
# First time: create a test VM from a Fedora cloud image (~10-15 min)
make vm-create VM=gssmn-fedora42

# List VMs and their status (running/shut off)
make vm-list

# Start/stop VMs (created once, reused across sessions)
make vm-start VM=gssmn-fedora42
make vm-stop VM=gssmn-fedora42
```

#### Testing workflow

```bash
# Run a full test cycle (deploy, screenshot, logs, health check)
make vm-test VM=gssmn-fedora42

# Fast iteration (skip snapshot restore, reuse current VM state)
./testing/vm/vm-test.sh --vm gssmn-fedora42 --no-restore --label quick-fix

# Just take a screenshot of the current VM state
./testing/vm/vm-test.sh --vm gssmn-fedora42 --screenshot-only --label check-ui
```

#### Pushing configs and visual testing

```bash
# Push a preset monitor config and screenshot
./testing/vm/vm-config.sh --vm gssmn-fedora42 --preset all-visible --screenshot

# List available presets
./testing/vm/vm-config.sh --list-presets

# Push a custom JSON config file
./testing/vm/vm-config.sh --vm gssmn-fedora42 my-config.json --screenshot

# Open interactive graphical session (virt-viewer)
make vm-viewer VM=gssmn-fedora42

# SSH into the VM
make vm-ssh VM=gssmn-fedora42
```

Config presets live in `testing/vm/configs/*.json`. Each is a JSON file with a `monitors` array and optional `settings` for globals.

#### Cleanup

```bash
# Tear down test VMs (preserves cached cloud images)
make vm-destroy VM=gssmn-fedora42
```

**Output:** Screenshots (PNG) and logs are saved to `testing/vm/results/`. The test script prints absolute file paths for easy inspection.

**For AI agents (Claude Code):** Run `vm-test.sh` with `run_in_background=true`, then `Read` the screenshot PNG and log file from the results.

### Translation

```bash
# Compile translations (happens automatically during build)
cd po && ./compile.sh ../system-monitor-next@paradoxxx.zero.gmail.com/locale
```

Translation files are in `po/<LANG>/system-monitor.po`.

## Architecture

### Core Files

All extension source files are in `system-monitor-next@paradoxxx.zero.gmail.com/`:

- **`extension.js`** (~300 lines): Extension lifecycle (enable/disable), config-driven widget instantiation
  - `WIDGET_CLASSES` lookup table maps type strings to constructors
  - `_syncMonitors()` handles live add/remove/reorder when `monitors` setting changes
- **`base.js`** (~900 lines): Widget framework
  - `ElementBase` — base class for all monitoring widgets; accepts `(extension, config)` constructor
  - `onSettingsChanged(newConfig)` for live config updates without recreating widgets
  - `collect()` API — widgets return `{metricKey: value}`, framework auto-updates display
  - `Chart` — stacked area graph rendering (Cairo)
  - `TipBox`/`TipMenu`/`TipItem` — tooltip system
  - `smStyleManager` — display styling and compact mode
  - Color helpers
- **`mounts.js`** (~340 lines): Filesystem monitoring and disk visualization
  - `smMountsMonitor` — tracks mounted filesystems
  - `Graph`/`Bar`/`Pie` — disk usage visualization for popup menu
- **`widgets/`**: Individual monitoring widgets (one file per metric type)
  - `cpu.js`, `memory.js`, `swap.js`, `network.js`, `disk.js`
  - `gpu.js`, `thermal.js`, `fan.js`, `frequency.js`
  - `battery.js`, `icon.js`
  - Each widget extends `ElementBase`, declares `static metadata`, and implements data collection
  - Widgets receive a `config` object with per-instance settings (device, colors, display, etc.)
  - `device_id` enables multi-device: multiple instances of same type monitoring different devices
- **`prefs.js`**: Preferences UI (GTK4/Adw)
  - General settings page (uses `ui/prefsGeneralSettings.ui` template)
  - Monitors page: dynamic monitor list with add/delete/reorder, reads/writes `monitors` GSettings key
- **`common.js`**: Shared utilities (`parse_bytearray()`, `check_sensors()`)
- **`utils.js`**: Logging (`sm_log()`)
- **`migration.js`**: Settings schema migration (v0 → v1 → v2)
  - v1→v2: converts per-widget GSettings keys into JSON `monitors` array

### Settings and Schemas

- **Schema XML:** `schemas/org.gnome.shell.extensions.system-monitor-next-applet.gschema.xml`
  - Must be compiled with `glib-compile-schemas` before use
  - **`monitors` key** (type `as`): JSON array of widget configurations — the primary config mechanism
  - Legacy per-widget keys (`{metric}-{property}`) remain for backward compat

- **Monitor config object shape** (each widget instance gets one):
  ```json
  {
    "uuid": "unique-id",
    "type": "cpu",
    "device": "all",
    "display": true,
    "style": "graph",
    "graph-width": 100,
    "refresh-time": 1500,
    "show-text": true,
    "show-menu": true,
    "colors": {"user": "#0072b3", "system": "#0092e6"}
  }
  ```

- **Display styles:** Each metric supports `digit`, `graph`, or `both` modes
- **Disk usage styles:** `pie`, `bar`, or `none`

### External Resources

- **`gpu_usage.sh`**: Shell script for GPU monitoring (NVIDIA via `nvidia-smi`, AMD via sysfs); accepts GPU index as `$1`
- **`stylesheet.css`**: Extension styling

### Monitoring Architecture

The extension follows a config-driven modular pattern:
1. On startup, `migration.js` converts legacy per-widget GSettings into a JSON `monitors` array (if needed)
2. `extension.js` reads `monitors`, looks up each config's `type` in `WIDGET_CLASSES`, and instantiates widgets with their config object
3. Each widget class in `widgets/` extends `ElementBase` from `base.js`, declares `static metadata` (identity, metrics, units), and uses `this.config` for per-instance settings
4. `ElementBase` handles shared concerns: config-driven initialization, update timers, chart rendering, tooltips, panel/menu item creation
5. Simple widgets implement `collect()` returning `{metricKey: value}`; complex widgets use `refresh()` + `_apply()`
6. `this.device_id` (from `config.device`) enables per-device monitoring — e.g. individual CPU cores, specific network interfaces, or GPU indices
7. When the `monitors` GSettings key changes, `_syncMonitors()` dynamically adds/removes/updates widgets without restarting

### Build Process

The Makefile orchestrates:
1. **Schema compilation:** Converts XML schema to binary format
2. **Translation compilation:** Converts `.po` files to `.mo` binaries
3. **Build assembly:** Copies source files + compiled assets to `_build/`

Note: when adding new JS modules in nested directories (e.g. `widgets/`), ensure the Makefile `build` target copies those directories into `_build/` as well.
4. **Version injection:** Replaces `"version": -1` with actual version in `metadata.json`
5. **Installation:** Copies to `~/.local/share/gnome-shell/extensions/` (or `$PREFIX`)

### Extension Loading

GNOME Shell loads extensions from:
- System: `/usr/share/gnome-shell/extensions/`
- User: `~/.local/share/gnome-shell/extensions/`

Each extension directory must contain `metadata.json` with UUID matching the directory name.

## Commit and Patch Standards

See [CONTRIBUTING.md](CONTRIBUTING.md) for full details. Key rules for AI agents:

- **One logical change per commit.** Don't mix bug fixes with refactors or features. If you find a pre-existing issue while working, fix it in a separate commit.
- **Every commit must build and run.** `make clean build` and `npm run lint` must pass at each commit. No intermediate broken states.
- **Subsystem prefix in commit messages:** `base:`, `widgets:`, `extension:`, `schemas:`, `prefs:`, `docs:`, `build:`. NOT project-phase tags like `widget-mod:`.
- **Correct dependency order.** If commit B uses code from commit A, A comes first. The series should read like a tutorial.
- **No intermediate scaffolding.** Don't add a file in one commit just to replace it later. No planning docs, AI logs, or task tracking files in commits.
- **Clean patch series.** When preparing a branch for merge, rebase to produce a clean series: squash fixups, reorder for logical flow, ensure each commit tells a coherent story. The series should look like it was written by someone who knew the final design from the start.
- **VM test before merging:** `./testing/vm/vm-test.sh --vm gssmn-fedora42 --label <name>`

## Important Notes

- **Network disk usage monitoring is disabled by default** (`ENABLE_NETWORK_DISK_USAGE = false` in `extension.js:53`) because stale network shares can freeze the shell
- The extension uses ES6 modules (import/export) introduced in GNOME Shell 45
- Settings migration happens automatically on extension load via `migrateSettings()` (current schema version: 2)
- The extension UUID is hardcoded throughout and must match the directory name
- Graph width, refresh times, and colors are all user-configurable per metric type
