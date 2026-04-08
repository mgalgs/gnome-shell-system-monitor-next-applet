#!/bin/bash
# Open an interactive SSH session to a test VM.
#
# Usage: vm-ssh.sh [--vm NAME] [-- command...]

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/vm-common.sh"

VM_TARGET=""
CMD_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) VM_TARGET="$2"; shift 2 ;;
        --) shift; CMD_ARGS=("$@"); break ;;
        -h|--help)
            echo "Usage: $0 [--vm NAME] [-- command...]"
            echo ""
            echo "Open an SSH session to a test VM, or run a command."
            echo ""
            echo "Examples:"
            echo "  $0                              # Interactive shell on default VM"
            echo "  $0 --vm gssmn-fedora42           # Interactive shell on specific VM"
            echo "  $0 -- journalctl --user -b -f    # Run command on default VM"
            echo ""
            echo "Available VMs:"
            vm_list_names | sed 's/^/  /'
            exit 0
            ;;
        *) VM_TARGET="$1"; shift ;;
    esac
done

if [[ -z "$VM_TARGET" ]]; then
    VM_TARGET=$(vm_default_name)
fi

vm_parse_config "$VM_TARGET"

if ! vm_is_running "$VM_TARGET"; then
    log_error "VM '$VM_TARGET' is not running"
    exit 1
fi

if [[ ${#CMD_ARGS[@]} -gt 0 ]]; then
    vm_ssh "$VM_TARGET" "${CMD_ARGS[@]}"
else
    # Interactive session (don't use vm_ssh since it wraps in DBUS export)
    local_port=$(vm_get_ssh_port "$VM_TARGET")
    exec ssh $SSH_OPTS -i "$SSH_KEY" -p "$local_port" "${SSH_USER}@localhost"
fi
