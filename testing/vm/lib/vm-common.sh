#!/bin/bash
# Shared variables, SSH helpers, config parsing, and logging for VM test harness.
# Source this file from other scripts: source "$(dirname "${BASH_SOURCE[0]}")/vm-common.sh"
#
# Uses qemu:///session (user-mode) — no root/sudo needed.
# VMs use SLIRP user-mode networking with SSH port forwarding.

set -euo pipefail

# --- Paths ---
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VM_DIR="$(cd "$LIB_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$VM_DIR/../.." && pwd)"
RESULTS_DIR="$VM_DIR/results"
CLOUD_INIT_DIR="$VM_DIR/cloud-init"
VMSCONF="$VM_DIR/vms.conf"

# --- Extension ---
EXT_UUID="system-monitor-next@paradoxxx.zero.gmail.com"

# --- Libvirt connection (user session, no root) ---
VIRSH="virsh -c qemu:///session"

# --- VM image cache and storage ---
# All files in user home — no special permissions needed.
CACHE_DIR="${HOME}/.local/share/gssmn-vm-testing"
SSH_KEY="${HOME}/.ssh/id_gssmn"
SNAPSHOT_NAME="clean-gnome-session"

# --- SSH options ---
SSH_USER="testuser"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes -o LogLevel=ERROR"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --- Logging ---
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_ok() {
    echo -e "${GREEN}[OK]${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# --- Config Parsing ---

# Parse a VM definition from vms.conf.
# Usage: vm_parse_config <vm_name>
# Sets: VM_NAME, VM_OS_VARIANT, VM_GNOME_VERSION, VM_IMAGE_URL, VM_VCPUS, VM_RAM_MB, VM_DISK_GB, VM_SSH_PORT
vm_parse_config() {
    local vm_name="$1"
    local line

    line=$(grep "^${vm_name}|" "$VMSCONF" 2>/dev/null || true)
    if [[ -z "$line" ]]; then
        log_error "VM '$vm_name' not found in $VMSCONF"
        echo "Available VMs:" >&2
        grep -v '^#' "$VMSCONF" | grep -v '^$' | cut -d'|' -f1 | sed 's/^/  /' >&2
        return 1
    fi

    IFS='|' read -r VM_NAME VM_OS_VARIANT VM_GNOME_VERSION VM_IMAGE_URL VM_VCPUS VM_RAM_MB VM_DISK_GB VM_SSH_PORT <<< "$line"
}

# Get the first VM name from vms.conf (default VM).
vm_default_name() {
    grep -v '^#' "$VMSCONF" | grep -v '^$' | head -1 | cut -d'|' -f1
}

# List all VM names from vms.conf.
vm_list_names() {
    grep -v '^#' "$VMSCONF" | grep -v '^$' | cut -d'|' -f1
}

# --- SSH Helpers ---

# Get the SSH port for a VM (from vms.conf).
vm_get_ssh_port() {
    local vm_name="$1"
    local line
    line=$(grep "^${vm_name}|" "$VMSCONF" 2>/dev/null || true)
    echo "$line" | cut -d'|' -f8
}

# Run a command on the VM via SSH (connects to localhost on the forwarded port).
# Usage: vm_ssh <vm_name> <command...>
vm_ssh() {
    local vm_name="$1"
    shift
    local port
    port=$(vm_get_ssh_port "$vm_name")

    ssh $SSH_OPTS -i "$SSH_KEY" -p "$port" "${SSH_USER}@localhost" \
        "export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u)/bus; $*"
}

# Run rsync to the VM.
# Usage: vm_rsync <vm_name> <src> <dest>
vm_rsync() {
    local vm_name="$1"
    local src="$2"
    local dest="$3"
    local port
    port=$(vm_get_ssh_port "$vm_name")

    rsync -az --delete \
        -e "ssh $SSH_OPTS -i $SSH_KEY -p $port" \
        "$src" "${SSH_USER}@localhost:${dest}"
}

# Wait for SSH to become available on the VM.
# Usage: vm_wait_ssh <vm_name> [timeout_secs]
vm_wait_ssh() {
    local vm_name="$1"
    local timeout="${2:-180}"
    local elapsed=0
    local interval=5

    log_info "Waiting for SSH on '$vm_name' (timeout: ${timeout}s)..."

    while [[ $elapsed -lt $timeout ]]; do
        if vm_ssh "$vm_name" "true" 2>/dev/null; then
            log_ok "SSH ready on '$vm_name' (${elapsed}s)"
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    log_error "SSH timeout after ${timeout}s for VM '$vm_name'"
    return 1
}

# Check if VM exists in libvirt.
vm_exists() {
    local vm_name="$1"
    $VIRSH dominfo "$vm_name" &>/dev/null
}

# Check if VM is running.
vm_is_running() {
    local vm_name="$1"
    local state
    state=$($VIRSH domstate "$vm_name" 2>/dev/null || true)
    [[ "$state" == "running" ]]
}

# Ensure the SSH key pair exists, generate if not.
ensure_ssh_key() {
    if [[ ! -f "$SSH_KEY" ]]; then
        log_info "Generating SSH key pair at $SSH_KEY"
        ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "gssmn-vm-test" -q
        log_ok "SSH key pair generated"
    fi
}

# Ensure cache directory exists.
ensure_cache_dir() {
    mkdir -p "$CACHE_DIR"
}
