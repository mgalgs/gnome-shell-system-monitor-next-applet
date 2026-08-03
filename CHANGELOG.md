# Changelog

Notable changes, newest first.

## Unreleased

### Changed measurements

- Disk read/write used the wrong sector-size conversion; every disk figure was 4× too small.
- "All disks" counted the same I/O once per storage layer (disk, partition, LVM, LUKS); it now counts physical disks only.
- Combined effect on the disk total: ~4× larger on a bare disk, ~2× larger on a partitioned one, about the same on encrypted LVM. The new figures match `iostat`.
- "All interfaces" counted VPN, bridge, and Docker traffic twice; it now counts physical interfaces only, so the total is lower and correct. ([#81], [#101])
- A monitor whose device cannot be read now shows `--` instead of a stale value, a zero, or a constant 99%.
- A Thermal or Fan monitor that was always blank now shows `--`; it has no sensor selected.

### Added

- One monitor can cover multiple devices, e.g. all CPU cores in a single entry. ([#150])
- Device selection has its own dialog; the monitor row shows a summary like "5 of 5 selected".
- Each device has its own Show Text switch, plus a bulk control for the whole list.
- A multi-device monitor is one grouped entry in the popup menu instead of one row per device.
- A new multi-device monitor picks a graph width that fits the panel.
- The disk picker lists every block device the panel can read, including LVM, LUKS, and zram devices.
- The network picker lists every interface, including tunnels NetworkManager does not manage such as `wg-quick`.
- A widget that cannot find its device logs the reason and the available devices to the journal.
- Devices have human names: "Core 1" instead of "0".
- Memory and Swap no longer show a one-item device picker.
- NetworkManager is no longer required.

### Fixed

- Preferences failed to open if a monitor config was missing `display` or `show-menu`.
- A monitor with many devices pushed "System Monitor…" and "Preferences…" off the bottom of the popup menu.
- A new multi-device monitor was created with its popup menu entry switched off.
- The popup menu went blank after a settings change until the next refresh.
- Network and disk totals showed a large negative rate when a device disappeared (VPN drop, USB unplug, LUKS/LVM close).
- Graphs on the same refresh interval drifted out of step; they now update together.
- The GPU picker showed two entries for the same card on hybrid-graphics machines.
- Only the first AMD GPU was detected.
- A disk monitor could match another device whose name contained its own.
- Two monitors with the same uuid left the panel half-built.
- A malformed `/proc/diskstats` row turned the disk total into NaN.
- Monitors that an old migration split one-per-core are merged back into a single entry.

### Performance

- Each data source (`/proc/stat`, `/proc/diskstats`, `/proc/net/dev`, `sensors`, the GPU script, Prometheus) is read once per tick and shared by all widgets.
- Widgets on the same refresh interval share one timer.
- GPU monitoring runs `nvidia-smi` once per tick instead of twice per GPU.
- Prometheus metrics from one server share one scrape per tick instead of one each.
- Sensor readings are no longer served from a cache up to a second stale.
