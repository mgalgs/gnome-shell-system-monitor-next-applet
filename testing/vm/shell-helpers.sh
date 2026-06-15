# shellcheck shell=bash
# Sourceable shell helpers for VM testing. Works in bash and zsh.
# Usage: source testing/vm/shell-helpers.sh
#
#   gssmn_ssh <vm_name> [command...]

# shellcheck disable=SC2296  # zsh ${(%):-%x} fallback; never evaluated under bash
_GSSMN_VM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
_GSSMN_VMSCONF="$_GSSMN_VM_DIR/vms.conf"
_GSSMN_SSH_KEY="$HOME/.ssh/id_gssmn"
_GSSMN_SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o LogLevel=ERROR)

gssmn_ssh() {
    local vm_name="$1"
    shift
    local port
    port=$(grep "^${vm_name}|" "$_GSSMN_VMSCONF" 2>/dev/null | cut -d'|' -f8)
    if [[ -z "$port" ]]; then
        echo "Unknown VM: $vm_name" >&2
        echo "Available: $(grep -v '^#' "$_GSSMN_VMSCONF" | grep -v '^$' | cut -d'|' -f1 | tr '\n' ' ')" >&2
        return 1
    fi
    if [[ $# -eq 0 ]]; then
        ssh "${_GSSMN_SSH_OPTS[@]}" -i "$_GSSMN_SSH_KEY" -p "$port" "testuser@localhost"
    else
        ssh "${_GSSMN_SSH_OPTS[@]}" -i "$_GSSMN_SSH_KEY" -p "$port" "testuser@localhost" \
            "export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u)/bus; $*"
    fi
}
