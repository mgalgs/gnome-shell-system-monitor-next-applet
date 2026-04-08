# VM-Based Functional Testing

Automated testing infrastructure for the GNOME Shell System Monitor extension. Creates isolated VMs from cloud images, deploys the extension, and captures screenshots and GNOME Shell logs for verification.

**No root access or system-level configuration required.** Everything runs in userspace via `qemu:///session` with `passt` networking.

## Prerequisites

Install these packages (names may vary by distro):

- `libvirt` / `qemu`
- `virt-install`
- `passt` (userspace networking backend)
- `genisoimage` (cloud-init seed ISO generation)
- `imagemagick` (screenshot conversion)

On Arch Linux:

```bash
sudo pacman -S libvirt qemu-full virt-install passt cdrtools imagemagick
```

On Fedora:

```bash
sudo dnf install libvirt qemu-kvm virt-install passt genisoimage ImageMagick
```

## Quick Start

```bash
# Create a test VM (downloads cloud image, installs GNOME, takes snapshot)
# ~10 minutes first time; cloud image is cached for subsequent creates.
make vm-create

# Run a test (restore snapshot, build, deploy, screenshot, logs)
make vm-test

# Open interactive graphical session for manual inspection
make vm-viewer

# Tear down all VMs (cached cloud images are preserved)
make vm-destroy
```

## Make Targets

All VM operations are available as Make targets. Use `VM=` to target a specific VM (defaults to the first entry in `vms.conf`):

```bash
make vm-create                    # Create default VM
make vm-create VM=gssmn-fedora42  # Create specific VM
make vm-test VM=gssmn-fedora42    # Smoke test on specific VM
make vm-viewer VM=gssmn-fedora42  # Interactive SPICE graphical session
make vm-ssh VM=gssmn-fedora42     # SSH into VM
make vm-destroy VM=gssmn-fedora42 # Tear down specific VM
make vm-destroy                   # Tear down all VMs
```

Full matrix testing with comparison reports:

```bash
make vm-test-all LABEL=master-baseline
make vm-test-all LABEL=my-feature BASELINE=master-baseline
```

The underlying shell scripts in `testing/vm/` offer additional options (see [Scripts](#scripts) below), but the Make targets cover the common workflows.

## Test Matrix

The test matrix is defined in `vms.conf`. Each line defines a VM with its distro, GNOME Shell version, cloud image URL, and SSH port:

| VM Name          | Distro       | GNOME Shell | SSH Port |
|------------------|--------------|-------------|----------|
| gssmn-fedora39   | Fedora 39    | 45          | 2222     |
| gssmn-fedora40   | Fedora 40    | 46          | 2223     |
| gssmn-fedora41   | Fedora 41    | 47          | 2224     |
| gssmn-fedora42   | Fedora 42    | 48          | 2225     |
| gssmn-fedora43   | Fedora 43    | 49          | 2226     |
| gssmn-ubuntu2404 | Ubuntu 24.04 | 46          | 2227     |

## Scripts

### `vm-create.sh` -- Create Test VMs

```bash
./testing/vm/vm-create.sh                    # Create default (first) VM
./testing/vm/vm-create.sh --all              # Create all VMs in matrix
./testing/vm/vm-create.sh --vm gssmn-fedora42  # Create specific VM
./testing/vm/vm-create.sh --vm gssmn-fedora42 --force  # Recreate from scratch
```

What it does:
1. Downloads the cloud image (cached in `~/.local/share/gssmn-vm-testing/`)
2. Creates a CoW (copy-on-write) disk backed by the cached image
3. Generates a cloud-init seed ISO with SSH keys and initial packages
4. Creates the VM via `virt-install` with passt user-mode networking
5. Waits for cloud-init, then installs GNOME desktop + extension dependencies
6. Configures GDM auto-login, disables screen lock/idle
7. Takes a live snapshot (`clean-gnome-session`) with GNOME Shell running

### `vm-test.sh` -- Test Extension in a VM

```bash
./testing/vm/vm-test.sh                         # Test on default VM
./testing/vm/vm-test.sh --vm gssmn-fedora43     # Test on specific VM
./testing/vm/vm-test.sh --no-restore            # Skip snapshot restore (faster)
./testing/vm/vm-test.sh --label my-change       # Label output files
./testing/vm/vm-test.sh --screenshot-only       # Just take a screenshot
./testing/vm/vm-test.sh --create                # Create VM if missing
```

What it does:
1. Restores VM to clean snapshot (unless `--no-restore`)
2. Builds the extension locally (`make clean build`)
3. Deploys via rsync + compiles schemas (both in extension dir and system-wide)
4. If first deploy: restarts GDM so GNOME Shell discovers the new extension
5. Enables extension via `gnome-extensions enable`
6. Runs health checks (gnome-shell alive, extension ACTIVE, no JS errors)
7. Captures screenshot via `virsh screenshot` (PPM -> PNG)
8. Captures GNOME Shell journal logs
9. Prints structured results

**Output:**
```
=== VM Test Results ===
VM: gssmn-fedora42 (GNOME 48)
Status: PASS
GNOME Shell: running
Crash: none detected
Extension: ACTIVE
JS Errors: none
Screenshot: /absolute/path/to/results/screenshot.png
Logs: /absolute/path/to/results/logs.log
Duration: 27s
```

**Exit codes:** 0 = PASS, 1 = FAIL (extension error), 2 = infrastructure error

### `vm-test-matrix.sh` -- Test Across All VMs

```bash
# Run baseline
./testing/vm/vm-test-matrix.sh --label master-baseline

# Test a branch and compare against baseline
./testing/vm/vm-test-matrix.sh --label pr138 --baseline master-baseline

# Test specific VMs only
./testing/vm/vm-test-matrix.sh --label quick --vm gssmn-fedora42 --vm gssmn-ubuntu2404

# Create missing VMs automatically
./testing/vm/vm-test-matrix.sh --label full --create
```

Generates an HTML comparison report at `testing/vm/results/<label>/report.html` with side-by-side screenshots for each GNOME version.

### `vm-viewer.sh` -- Interactive Graphical Access

```bash
./testing/vm/vm-viewer.sh                       # Open default VM
./testing/vm/vm-viewer.sh gssmn-fedora42        # Open specific VM
./testing/vm/vm-viewer.sh --vm gssmn-ubuntu2404 # Open Ubuntu VM
```

Opens a SPICE viewer window connected to the VM's live GNOME desktop. You can interact with the desktop directly — click the extension panel, open preferences, test different configurations, etc. Useful for manual verification and debugging beyond what automated screenshots capture.

### `vm-destroy.sh` -- Tear Down VMs

```bash
./testing/vm/vm-destroy.sh --vm gssmn-fedora42  # Destroy specific VM
./testing/vm/vm-destroy.sh --all                 # Destroy all VMs
```

Cached cloud base images in `~/.local/share/gssmn-vm-testing/` are preserved so subsequent `vm-create.sh` runs skip the download.

## Typical Workflows

### Testing a PR

```bash
# 1. Ensure VMs exist (skip if already created)
./testing/vm/vm-create.sh --all

# 2. Run baseline on master
./testing/vm/vm-test-matrix.sh --label master-baseline

# 3. Check out the PR
gh pr checkout 138

# 4. Run tests and compare
./testing/vm/vm-test-matrix.sh --label pr138 --baseline master-baseline

# 5. Open the HTML report
xdg-open testing/vm/results/pr138/report.html
```

### Quick Iteration During Development

```bash
# First test (with snapshot restore, ~27s)
./testing/vm/vm-test.sh --vm gssmn-fedora42 --label my-change

# Subsequent tests (skip restore, ~12s)
./testing/vm/vm-test.sh --vm gssmn-fedora42 --no-restore --label my-change-v2

# Just check the screenshot
./testing/vm/vm-test.sh --vm gssmn-fedora42 --screenshot-only --label check
```

### AI Agent (Claude Code) Workflow

```bash
# Run in background so the agent can continue working
./testing/vm/vm-test.sh --label fix-cpu --no-restore  # run_in_background=true

# Agent reads the screenshot (PNG) and log file from the results path
# If issues found, fixes code and re-runs. Full autonomous loop.
```

## Architecture

```
testing/vm/
  vm-create.sh              # Create VMs from cloud images
  vm-test.sh                # Test extension in a single VM
  vm-test-matrix.sh         # Test across all VMs, generate HTML report
  vm-destroy.sh             # Tear down VMs
  vms.conf                  # VM definitions (distro, GNOME version, image URL, SSH port)
  cloud-init/
    user-data.yaml          # Cloud-init user config (testuser, SSH key, packages)
    meta-data.yaml          # Cloud-init instance metadata
    generate-seed.sh        # Creates seed ISO via genisoimage
  lib/
    vm-common.sh            # SSH helpers, config parsing, logging
    vm-provision.sh         # Post-boot: install GNOME, configure auto-login
    vm-snapshot.sh           # Snapshot create/restore
    vm-deploy.sh            # Build + rsync + schema install + enable
    vm-screenshot.sh        # virsh screenshot -> PNG
    vm-logs.sh              # GNOME Shell journal capture
    vm-health.sh            # Health checks (alive, active, no JS errors)
  results/                  # Screenshots and logs (gitignored)
```

### Networking

VMs use `passt` user-mode networking (no bridge, no root). The host connects to VMs via SSH port forwarding on localhost:

- `localhost:2222` -> gssmn-fedora39 port 22
- `localhost:2223` -> gssmn-fedora40 port 22
- etc.

VMs have full outbound internet access (for `dnf install`, etc.) through the host's network stack.

### Snapshots

VMs use **live snapshots** that capture the full memory state with GNOME Shell running. `virsh snapshot-revert` restores to a running desktop in ~0 seconds (no boot wait).

**Note on screenshot timestamps:** Because live snapshots restore the VM's memory state including the system clock, screenshots taken after a snapshot restore may show the same wall clock time as the original snapshot. The in-VM clock catches up after a few seconds, but the screenshot may be captured before this happens. This is cosmetic and does not affect test validity — the extension code being tested is always freshly deployed after the restore.

### Storage

All VM data lives in `~/.local/share/gssmn-vm-testing/`:
- Cloud base images (~500MB each, downloaded once, shared across VM recreations)
- VM disks (CoW format, only store differences from the base image)
- SSH key pair
- Seed ISOs

## Adding a New VM to the Matrix

1. Find the cloud image URL for your target distro/version
2. Add a line to `vms.conf` with a unique name, `os-variant`, GNOME version, image URL, resources, and SSH port
3. If the distro isn't Fedora or Debian/Ubuntu, add a case to `lib/vm-provision.sh` for its package manager
4. Run `./testing/vm/vm-create.sh --vm <name>`
5. Run `./testing/vm/vm-test.sh --vm <name>` to verify

## Limitations

The automated tests are **smoke tests**, not comprehensive functional tests. They verify the extension loads and activates without errors, but don't exercise all functionality:

**What the automated tests DO cover:**
- Extension loads without crashing GNOME Shell on every supported version
- Extension reaches `ACTIVE` state (no schema errors, no import failures)
- No JS errors in GNOME Shell journal
- Visual presence in top panel (via screenshot)

**What they DON'T cover:**
- Whether CPU/memory/disk/network values actually update correctly
- Graph rendering with real data
- Popup menu interaction (clicking the extension)
- Preferences dialog functionality
- GPU monitoring (VMs use virtio-gpu, no NVIDIA/AMD hardware)
- Battery monitoring (VMs have no real battery)
- Different display modes (graph/digit/both)
- Multi-monitor configurations
- Interaction with other extensions

**For deeper verification**, use `vm-viewer.sh` to open an interactive session and manually inspect the extension behavior. The VMs have full GNOME desktops with working system metrics, so CPU, memory, disk, and network monitoring all function (just with VM-level hardware).

## Troubleshooting

## Managing VMs with virsh

The test VMs run under `qemu:///session` (user-mode), not the default `qemu:///system`. Set the environment variable to avoid typing `-c qemu:///session` on every command:

```bash
export LIBVIRT_DEFAULT_URI=qemu:///session
```

Or add it to your shell profile. Then standard virsh commands work as expected:

```bash
virsh list --all              # List all test VMs
virsh start gssmn-fedora42    # Start a VM
virsh shutdown gssmn-fedora42 # Graceful shutdown
virsh destroy gssmn-fedora42  # Force stop
virsh console gssmn-fedora42  # Serial console (Ctrl+] to exit)
virsh snapshot-list gssmn-fedora42  # List snapshots
```

## Troubleshooting

**"VM already exists"**: Use `--force` flag with `vm-create.sh` to destroy and recreate.

**SSH timeout**: The VM may still be booting. Check `virsh -c qemu:///session list` to verify it's running. Try `ssh -p <port> testuser@localhost` manually.

**Extension state ERROR**: Check the log file for JS errors. Common cause: schemas not compiled system-wide. The deploy script handles this, but if you installed manually, run `sudo glib-compile-schemas /usr/share/glib-2.0/schemas/` inside the VM.

**Black screenshot**: GNOME Shell may have crashed. Check `journalctl --user -b` inside the VM for JS ERROR lines. The health check in `vm-test.sh` should detect this and report FAIL.

**"Snapshot not found"**: Run `virsh -c qemu:///session snapshot-list <vm-name>` to check. If missing, destroy and recreate the VM.
