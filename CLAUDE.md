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
# Install the extension locally
make install gschemas.install-and-compile

# Uninstall the extension
make uninstall

# Build without installing (creates _build/ directory)
make build

# Clean build artifacts
make clean

# Create distribution zip for extensions.gnome.org
make zip-file VERSION=<version>
```

### Development Workflow

After making changes to the extension code:

```bash
# Reinstall and recompile schemas
make uninstall install gschemas.install-and-compile
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
# Run ESLint on extension code
./checkjs.sh
# Or directly:
eslint system-monitor-next@paradoxxx.zero.gmail.com
```

ESLint configuration is in `eslint.config.js` (flat config format, ES2022, 4-space indent, single quotes, max line length 160).

### VM-Based Functional Testing

Automated testing in an isolated VM with a real GNOME Shell session. Requires `libvirt`, `virt-install`, `qemu-img`, `genisoimage`, and `ImageMagick`.

```bash
# First time: create a test VM from a Fedora cloud image (~10-15 min)
make vm-create
# Or: ./testing/vm/vm-create.sh --vm gssmn-fedora42

# Run a full test cycle (deploy, screenshot, logs, health check)
make vm-test
# Or: ./testing/vm/vm-test.sh --vm gssmn-fedora42 --label my-change

# Fast iteration (skip snapshot restore, reuse current VM state)
./testing/vm/vm-test.sh --no-restore --label quick-fix

# Just take a screenshot of the current VM state
./testing/vm/vm-test.sh --screenshot-only --label check-ui

# Tear down test VMs (preserves cached cloud images)
make vm-destroy
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

- **`extension.js`** (~2766 lines): Main extension logic
  - Creates the panel button and status indicators
  - Implements monitoring classes for CPU, memory, disk, network, GPU, battery, temperature
  - Each metric type has its own class extending base monitoring classes
  - Uses GTop library for system metrics
  - Handles graph/digit/both display modes
  - Manages popup menu with detailed statistics

- **`prefs.js`**: Preferences UI implementation using GTK4/Adw
  - Uses `.ui` files from `ui/` directory for interface definition
  - Implements multiple preferences pages for different metric types
  - Binds GSettings to UI widgets

- **`common.js`**: Shared utilities
  - `parse_bytearray()`: Decodes byte arrays to UTF-8 strings
  - `check_sensors()`: Scans `/sys/class/hwmon/` for temperature/fan sensors

- **`utils.js`**: Logging utility
  - `sm_log()`: Prefixed logging function

- **`migration.js`**: Settings schema migration logic
  - Handles version upgrades of settings schema
  - Tracks schema version in `settings-schema-version` key

### Settings and Schemas

- **Schema XML:** `schemas/org.gnome.shell.extensions.system-monitor-next-applet.gschema.xml`
  - Defines all extension settings (refresh times, colors, display styles, etc.)
  - Must be compiled with `glib-compile-schemas` before use
  - Settings IDs use pattern: `{metric}-{property}` (e.g., `memory-refresh-time`)

- **Display styles:** Each metric supports `digit`, `graph`, or `both` modes
- **Disk usage styles:** `pie`, `bar`, or `none`

### UI Definition Files

GTK4 interface definitions in `ui/`:
- `prefsGeneralSettings.ui`: General preferences page
- `prefsExpanderRow.ui`: Expandable preference rows
- `prefsWidgetSettings.ui`: Per-widget settings
- `prefsWidgetPositionList.ui`: Widget ordering interface
- Other preference page components

### External Resources

- **`gpu_usage.sh`**: Shell script for NVIDIA GPU monitoring (invoked via `nvidia-smi`)
- **`stylesheet.css`**: Extension styling

### Monitoring Architecture

The extension follows a modular pattern:
1. Each system metric (CPU, memory, etc.) has its own class
2. Classes implement data collection, visualization (graph/text), and menu items
3. Metrics are registered in the extension's initialization
4. Each metric respects user preferences for display style, refresh rate, colors
5. Graph rendering uses Clutter/Cogl for efficient drawing
6. Menu items provide detailed breakdown of each metric

### Build Process

The Makefile orchestrates:
1. **Schema compilation:** Converts XML schema to binary format
2. **Translation compilation:** Converts `.po` files to `.mo` binaries
3. **Build assembly:** Copies source files + compiled assets to `_build/`
4. **Version injection:** Replaces `"version": -1` with actual version in `metadata.json`
5. **Installation:** Copies to `~/.local/share/gnome-shell/extensions/` (or `$PREFIX`)

### Extension Loading

GNOME Shell loads extensions from:
- System: `/usr/share/gnome-shell/extensions/`
- User: `~/.local/share/gnome-shell/extensions/`

Each extension directory must contain `metadata.json` with UUID matching the directory name.

## Important Notes

- **Network disk usage monitoring is disabled by default** (`ENABLE_NETWORK_DISK_USAGE = false` in `extension.js:53`) because stale network shares can freeze the shell
- The extension uses ES6 modules (import/export) introduced in GNOME Shell 45
- Settings migration happens automatically on extension load via `migrateSettings()`
- The extension UUID is hardcoded throughout and must match the directory name
- Graph width, refresh times, and colors are all user-configurable per metric type
