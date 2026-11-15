#!/bin/bash
# Build a layered block stack on a test VM, for the disk-layers preset.
#
# Usage: vm-disk-layers.sh [--vm NAME] up|down
#
# up attaches a 2 GiB scratch disk as vdb, live only, so the VM's definition
# is unchanged, and builds:
#   vdb -> vdb1 -> dm-0 "layers-linear" (dm-linear, standing in for LUKS/LVM)
#   vdb -> vdb2 + vdb3 -> md0 (RAID-1, created clean, so no resync I/O)
#   /dev/shm file -> loop -> dm-1 .. dm-10 (dm-10's name contains dm-1's)
# It prints which block devices have a hardware `device` link.
#
# down removes the stack, wipes vdb so nothing reassembles at the next boot,
# and detaches it.
#
# To compare the panel with iostat, write through a layer at a fixed rate:
#   sudo systemd-run --scope -p "IOWriteBandwidthMax=/dev/mapper/layers-linear 32M" \
#       dd if=/dev/zero of=/dev/mapper/layers-linear bs=1M count=256 oflag=direct
#   iostat -d -m -y 1

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib/vm-common.sh"

usage() { echo "Usage: $0 [--vm NAME] up|down" >&2; exit 2; }

TARGET_VM=""
ACTION=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        up|down) ACTION="$1"; shift ;;
        *) usage ;;
    esac
done
[[ -n "$ACTION" ]] || usage
[[ -n "$TARGET_VM" ]] || TARGET_VM=$(vm_default_name)
vm_parse_config "$TARGET_VM"
if ! vm_is_running "$TARGET_VM"; then
    log_error "VM '$TARGET_VM' is not running"
    exit 1
fi

SCRATCH="$CACHE_DIR/${TARGET_VM}-vdb-scratch.img"
VDB_SOURCE=$($VIRSH domblklist "$TARGET_VM" | awk '$1 == "vdb" {print $2}')
if [[ -n "$VDB_SOURCE" && "$VDB_SOURCE" != "$SCRATCH" ]]; then
    log_error "vdb on $TARGET_VM is $VDB_SOURCE, not $SCRATCH; leaving it alone"
    exit 1
fi

if [[ "$ACTION" == down ]]; then
    vm_ssh "$TARGET_VM" sudo bash -s <<'EOF' || log_warn "Teardown on $TARGET_VM reported an error"
for holder in /sys/class/block/vdb[0-9]*/holders/md*; do
    [[ -e $holder ]] && mdadm --stop "/dev/${holder##*/}"
done
for i in $(seq 1 10); do dmsetup remove "layers-slice$i" 2>/dev/null; done
dmsetup remove layers-linear 2>/dev/null
for loop in $(losetup -j /dev/shm/disk-layers.img | cut -d: -f1); do
    losetup -d "$loop"
done
rm -f /dev/shm/disk-layers.img
[[ -b /dev/vdb ]] || exit 0
mdadm --zero-superblock /dev/vdb2 /dev/vdb3 2>/dev/null
wipefs -q -a /dev/vdb1 /dev/vdb2 /dev/vdb3 2>/dev/null
wipefs -q -a /dev/vdb
EOF
    if [[ -n "$VDB_SOURCE" ]]; then
        $VIRSH detach-disk "$TARGET_VM" vdb --live >/dev/null
    fi
    log_ok "Disk stack removed from $TARGET_VM"
    exit 0
fi

if [[ -z "$VDB_SOURCE" ]]; then
    [[ -f "$SCRATCH" ]] || qemu-img create -q -f raw "$SCRATCH" 2G
    $VIRSH attach-disk "$TARGET_VM" "$SCRATCH" vdb \
        --driver qemu --subdriver raw --targetbus virtio --live >/dev/null
fi

vm_ssh "$TARGET_VM" sudo bash -s <<'EOF'
set -euo pipefail
command -v iostat >/dev/null || echo "iostat not found: install sysstat to compare with it" >&2
udevadm settle
if compgen -G '/sys/class/block/dm-*' >/dev/null; then
    echo "device-mapper devices already exist, so dm-0 would not be layers-linear" >&2
    exit 1
fi

sfdisk --quiet /dev/vdb <<'TABLE'
label: gpt
size=1G
size=400M
size=400M
TABLE
udevadm settle

dmsetup create layers-linear --table "0 $(blockdev --getsz /dev/vdb1) linear /dev/vdb1 0"
mdadm --create /dev/md0 --level=1 --raid-devices=2 --run --assume-clean \
    --bitmap=none --metadata=1.2 /dev/vdb2 /dev/vdb3

truncate -s 64M /dev/shm/disk-layers.img
loop=$(losetup -f --show /dev/shm/disk-layers.img)
for i in $(seq 1 10); do
    dmsetup create "layers-slice$i" --table "0 8192 linear $loop $(( (i - 1) * 8192 ))"
done
udevadm settle

for dev in /sys/class/block/*; do
    printf '%-8s %s\n' "${dev##*/}" "$([[ -e $dev/device ]] && echo hardware || echo -)"
done
EOF
log_ok "Disk stack built on $TARGET_VM"
