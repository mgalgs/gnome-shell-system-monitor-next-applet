#!/bin/bash
# Snapshot management for test VMs.
# Source vm-common.sh before using these functions.

# Create a named snapshot of a running VM (includes memory state for instant restore).
# Usage: snapshot_create <vm_name> [snapshot_name] [description]
snapshot_create() {
    local vm_name="$1"
    local snap_name="${2:-$SNAPSHOT_NAME}"
    local description="${3:-Clean GNOME session ready for extension testing}"

    if ! vm_is_running "$vm_name"; then
        log_error "VM '$vm_name' must be running to create a live snapshot"
        return 1
    fi

    # Delete existing snapshot with same name if present
    if $VIRSH snapshot-list "$vm_name" --name 2>/dev/null | grep -q "^${snap_name}$"; then
        log_info "Deleting existing snapshot '$snap_name'..."
        $VIRSH snapshot-delete "$vm_name" "$snap_name" &>/dev/null || true
    fi

    log_info "Creating snapshot '$snap_name' for VM '$vm_name'..."
    $VIRSH snapshot-create-as "$vm_name" "$snap_name" --description "$description" --atomic
    log_ok "Snapshot '$snap_name' created"
}

# Restore a VM to a named snapshot.
# For live snapshots (with memory), this restores to a running state instantly.
# Usage: snapshot_restore <vm_name> [snapshot_name]
snapshot_restore() {
    local vm_name="$1"
    local snap_name="${2:-$SNAPSHOT_NAME}"

    if ! $VIRSH snapshot-list "$vm_name" --name 2>/dev/null | grep -q "^${snap_name}$"; then
        log_error "Snapshot '$snap_name' not found for VM '$vm_name'"
        return 1
    fi

    log_info "Restoring VM '$vm_name' to snapshot '$snap_name'..."
    $VIRSH snapshot-revert "$vm_name" "$snap_name"

    # If VM isn't running after restore (disk-only snapshot), start it
    if ! vm_is_running "$vm_name"; then
        log_info "Starting VM after snapshot restore..."
        $VIRSH start "$vm_name"
    fi

    log_ok "Snapshot '$snap_name' restored"
}

# Check if a snapshot exists for a VM.
# Usage: snapshot_exists <vm_name> [snapshot_name]
snapshot_exists() {
    local vm_name="$1"
    local snap_name="${2:-$SNAPSHOT_NAME}"

    $VIRSH snapshot-list "$vm_name" --name 2>/dev/null | grep -q "^${snap_name}$"
}
