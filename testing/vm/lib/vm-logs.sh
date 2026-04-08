#!/bin/bash
# Capture GNOME Shell logs from a test VM via journalctl.
#
# Usage: source vm-common.sh; capture_logs <vm_name> <label> [since_time]
# Outputs the path to the log file.

# Capture relevant logs from the VM.
# Prints the absolute path of the log file to stdout.
capture_logs() {
    local vm_name="$1"
    local label="${2:-logs}"
    local since="${3:-5 minutes ago}"
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)

    local log_file="$RESULTS_DIR/${vm_name}_${label}_${timestamp}.log"

    mkdir -p "$RESULTS_DIR"

    # Capture GNOME Shell / extension logs
    vm_ssh "$vm_name" "
        echo '=== GNOME Shell Journal Logs ==='
        journalctl --user -b --since='$since' --no-pager 2>/dev/null \
            | grep -iE 'gnome-shell|system-monitor|extension|JS ERROR|gjs' || true

        echo ''
        echo '=== Extension State ==='
        gnome-extensions show $EXT_UUID 2>/dev/null || echo 'Extension not found'

        echo ''
        echo '=== GNOME Shell Version ==='
        gnome-shell --version 2>/dev/null || echo 'unknown'
    " > "$log_file" 2>/dev/null || true

    if [[ -f "$log_file" ]]; then
        log_ok "Logs saved: $log_file"
        echo "$log_file"
    else
        log_error "Log capture failed"
        return 1
    fi
}
