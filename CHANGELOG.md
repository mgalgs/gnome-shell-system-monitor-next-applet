# Changelog

Notable changes, newest first. Entries are written for someone who noticed
something different on their panel and came here to find out whether it is a bug.

## Unreleased

### Your disk read and write figures will look different — and the new ones are right

Two separate errors had been partly cancelling each other out. The panel used the
wrong conversion from disk sectors to MiB, which made every figure four times too
small. And *All disks* added up the same read or write once for every layer of
your storage — once for the partition, again for LVM or disk encryption if you use
them, and again for the disk itself.

Because they pulled in opposite directions, how far your number moves depends on
your setup: roughly **4× larger** with a single unpartitioned disk, **2× larger**
with an ordinary partitioned one, and **about the same** if you run LVM on an
encrypted partition.

Whichever it is, the figure now matches what `iostat` reports for the same moment.
If it does not, that is a bug worth filing.

Separately, the device list in preferences now offers every disk on your machine —
including LVM volumes, encrypted devices and zram — instead of the four families
of names it used to recognise.

### A monitor with no reading now shows `--` instead of a number it does not have

A disk that was unplugged, a CPU core this machine does not have, a sensor that is
not on this machine, an interface that was renamed — each of these used to show a
stale figure, a zero, or in one case a large negative rate, all of which looked
like measurements. They now show `--`, and the journal names what the source did
contain.

If a Thermal or Fan monitor on your panel has always been blank, it will now read
`--`. It never had a sensor selected; pick one in preferences, or remove the
monitor.

### Network totals no longer count tunnelled and bridged traffic twice

If you use a VPN, a bridge, or Docker, the *All interfaces* figure was roughly
double the real throughput: the same bytes were counted once on the virtual
interface and again on the hardware carrying them. It now counts only the
interfaces where traffic actually enters or leaves the machine, so the number will
be **lower, and correct**. ([#81], [#101])

To watch a tunnel or bridge specifically, add a monitor for that interface in
preferences — which now also works for tunnels NetworkManager does not manage,
such as `wg-quick`.

[#81]: https://github.com/mgalgs/gnome-shell-system-monitor-next-applet/issues/81
[#101]: https://github.com/mgalgs/gnome-shell-system-monitor-next-applet/issues/101
