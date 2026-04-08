#!/bin/bash
# Create a test VM from a cloud image.
# Downloads the cloud image (cached), creates a CoW disk, generates cloud-init seed ISO,
# runs virt-install, provisions GNOME desktop + deps, and takes a clean snapshot.
#
# Uses qemu:///session (user-mode) — no root/sudo needed.
# VMs use SLIRP user-mode networking with SSH port forwarding.
#
# Usage: vm-create.sh [--vm NAME | --all] [--force]
#
# The VM is ready for testing after this script completes.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/vm-common.sh"
source "$LIB_DIR/vm-snapshot.sh"

# --- Argument parsing ---
TARGET_VM=""
ALL_VMS=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        --all) ALL_VMS=true; shift ;;
        --force) FORCE=true; shift ;;
        -h|--help)
            echo "Usage: $0 [--vm NAME | --all] [--force]"
            echo ""
            echo "Create test VMs from cloud images defined in vms.conf."
            echo ""
            echo "Options:"
            echo "  --vm NAME   Create a specific VM (default: first in vms.conf)"
            echo "  --all       Create all VMs defined in vms.conf"
            echo "  --force     Destroy and recreate if VM already exists"
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Determine which VMs to create ---
if $ALL_VMS; then
    VM_NAMES=$(vm_list_names)
elif [[ -n "$TARGET_VM" ]]; then
    VM_NAMES="$TARGET_VM"
else
    VM_NAMES=$(vm_default_name)
fi

# --- Ensure prerequisites ---
ensure_cache_dir
ensure_ssh_key

# --- Create each VM ---
for vm_name in $VM_NAMES; do
    echo ""
    log_info "=========================================="
    log_info "Creating VM: $vm_name"
    log_info "=========================================="

    # Parse config
    vm_parse_config "$vm_name"

    # Check if already exists
    if vm_exists "$vm_name"; then
        if $FORCE; then
            log_warn "VM '$vm_name' exists, destroying (--force)..."
            $VIRSH destroy "$vm_name" 2>/dev/null || true
            $VIRSH undefine "$vm_name" --remove-all-storage --snapshots-metadata 2>/dev/null || true
            sleep 2
        else
            log_warn "VM '$vm_name' already exists. Use --force to recreate."
            continue
        fi
    fi

    # --- Step 1: Download cloud image ---
    IMAGE_FILENAME=$(basename "$VM_IMAGE_URL")
    CACHED_IMAGE="$CACHE_DIR/$IMAGE_FILENAME"

    if [[ -f "$CACHED_IMAGE" ]]; then
        log_ok "Cloud image already cached: $CACHED_IMAGE"
    else
        log_info "Downloading cloud image: $IMAGE_FILENAME"
        log_info "URL: $VM_IMAGE_URL"
        curl -L --progress-bar -o "$CACHED_IMAGE.tmp" "$VM_IMAGE_URL"
        mv "$CACHED_IMAGE.tmp" "$CACHED_IMAGE"
        log_ok "Cloud image downloaded: $CACHED_IMAGE"
    fi

    # --- Step 2: Create CoW disk from cached image ---
    VM_DISK="$CACHE_DIR/${vm_name}.qcow2"
    log_info "Creating CoW disk (${VM_DISK_GB}GB) backed by cloud image..."
    qemu-img create -f qcow2 -b "$CACHED_IMAGE" -F qcow2 "$VM_DISK" "${VM_DISK_GB}G"
    log_ok "VM disk created: $VM_DISK"

    # --- Step 3: Generate cloud-init seed ISO ---
    SEED_ISO="$CACHE_DIR/${vm_name}-seed.iso"
    log_info "Generating cloud-init seed ISO..."
    "$CLOUD_INIT_DIR/generate-seed.sh" "$SEED_ISO" "${SSH_KEY}.pub"

    # --- Step 4: Create VM with virt-install (user session, user-mode networking) ---
    log_info "Creating VM with virt-install (qemu:///session)..."
    virt-install \
        --connect qemu:///session \
        --name "$vm_name" \
        --os-variant "$VM_OS_VARIANT" \
        --vcpus "$VM_VCPUS" \
        --memory "$VM_RAM_MB" \
        --disk "path=$VM_DISK,format=qcow2" \
        --disk "path=$SEED_ISO,device=cdrom" \
        --network user,model=virtio,backend.type=passt,portForward0.proto=tcp,portForward0.range0.start=${VM_SSH_PORT},portForward0.range0.to=22 \
        --graphics spice,gl.enable=no,listens0.type=socket \
        --video virtio \
        --noautoconsole \
        --import
    log_ok "VM created and booting (SSH forwarded to localhost:$VM_SSH_PORT)"

    # --- Step 5: Wait for cloud-init to complete ---
    log_info "Waiting for cloud-init to finish (SSH key setup, packages)..."
    vm_wait_ssh "$vm_name" 300

    # Wait for cloud-init to fully complete
    log_info "Waiting for cloud-init to finish all tasks..."
    ci_timeout=300
    ci_elapsed=0
    while [[ $ci_elapsed -lt $ci_timeout ]]; do
        if vm_ssh "$vm_name" "test -f /var/lib/cloud/instance/boot-finished" 2>/dev/null; then
            log_ok "cloud-init complete"
            break
        fi
        sleep 10
        ci_elapsed=$((ci_elapsed + 10))
    done

    if [[ $ci_elapsed -ge $ci_timeout ]]; then
        log_warn "cloud-init may not have completed fully, proceeding anyway..."
    fi

    # --- Step 6: Run post-boot provisioning ---
    "$LIB_DIR/vm-provision.sh" "$vm_name"

    # --- Step 7: Take clean snapshot ---
    log_info "Taking clean snapshot..."
    snapshot_create "$vm_name" "$SNAPSHOT_NAME" "Clean GNOME session for $vm_name (GNOME $VM_GNOME_VERSION)"

    log_ok "=========================================="
    log_ok "VM '$vm_name' is ready for testing!"
    log_ok "  GNOME Shell version: $VM_GNOME_VERSION"
    log_ok "  SSH: ssh -p $VM_SSH_PORT testuser@localhost"
    log_ok "  Snapshot: $SNAPSHOT_NAME"
    log_ok "=========================================="
done
