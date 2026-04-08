#!/bin/bash
# Open an interactive graphical session to a test VM via virt-viewer.
# Useful for manual verification, debugging, and visual inspection.
#
# Usage: vm-viewer.sh [--vm NAME]

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/vm-common.sh"

VM_NAME=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) VM_NAME="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--vm NAME]"
            echo ""
            echo "Open a graphical session to a test VM."
            echo "Default: first VM in vms.conf"
            echo ""
            echo "Available VMs:"
            vm_list_names | sed 's/^/  /'
            exit 0
            ;;
        *) VM_NAME="$1"; shift ;;
    esac
done

if [[ -z "$VM_NAME" ]]; then
    VM_NAME=$(vm_default_name)
fi

if ! vm_exists "$VM_NAME"; then
    log_error "VM '$VM_NAME' does not exist. Run: vm-create.sh --vm $VM_NAME"
    exit 1
fi

if ! vm_is_running "$VM_NAME"; then
    log_info "Starting VM '$VM_NAME'..."
    $VIRSH start "$VM_NAME"
    sleep 3
fi

vm_parse_config "$VM_NAME"
log_info "Opening viewer for $VM_NAME (GNOME $VM_GNOME_VERSION)"
log_info "SSH also available: ssh -i $SSH_KEY -p $VM_SSH_PORT testuser@localhost"

exec virt-viewer -c qemu:///session "$VM_NAME"
