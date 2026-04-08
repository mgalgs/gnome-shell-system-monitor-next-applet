#!/bin/bash
# Destroy test VMs and remove their disk images.
# Cached cloud base images are preserved for fast recreation.
#
# Usage: vm-destroy.sh [--vm NAME | --all]

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/vm-common.sh"

# --- Argument parsing ---
TARGET_VM=""
ALL_VMS=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        --all) ALL_VMS=true; shift ;;
        -h|--help)
            echo "Usage: $0 [--vm NAME | --all]"
            echo ""
            echo "Destroy test VMs. Cached cloud images are preserved."
            echo ""
            echo "Options:"
            echo "  --vm NAME   Destroy a specific VM"
            echo "  --all       Destroy all VMs defined in vms.conf"
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

if ! $ALL_VMS && [[ -z "$TARGET_VM" ]]; then
    log_error "Specify --vm NAME or --all"
    exit 1
fi

# --- Determine which VMs to destroy ---
if $ALL_VMS; then
    VM_NAMES=$(vm_list_names)
else
    VM_NAMES="$TARGET_VM"
fi

# --- Destroy each VM ---
for vm_name in $VM_NAMES; do
    if ! vm_exists "$vm_name"; then
        log_warn "VM '$vm_name' does not exist, skipping"
        continue
    fi

    log_info "Destroying VM '$vm_name'..."

    # Force stop if running
    if vm_is_running "$vm_name"; then
        $VIRSH destroy "$vm_name" 2>/dev/null || true
    fi

    # Undefine with storage removal
    $VIRSH undefine "$vm_name" --remove-all-storage --snapshots-metadata 2>/dev/null || true

    # Also clean up the seed ISO
    seed_iso="$CACHE_DIR/${vm_name}-seed.iso"
    if [[ -f "$seed_iso" ]]; then
        rm -f "$seed_iso"
    fi

    log_ok "VM '$vm_name' destroyed"
done

log_info "Cached cloud base images preserved in $CACHE_DIR"
