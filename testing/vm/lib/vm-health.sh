#!/bin/bash
# Health checks for GNOME Shell and the extension on a test VM.
#
# Usage: source vm-common.sh; check_health <vm_name>

# Check if GNOME Shell is running.
check_gnome_shell_alive() {
    local vm_name="$1"
    vm_ssh "$vm_name" "pgrep -x gnome-shell" &>/dev/null
}

# Check if the extension is enabled and active.
check_extension_active() {
    local vm_name="$1"
    vm_ssh "$vm_name" "gnome-extensions show $EXT_UUID 2>/dev/null | grep -q 'State: ACTIVE'"
}

# Check if there are JS errors related to the extension since a given time.
# Returns 0 if NO errors found (healthy), 1 if errors found.
check_no_js_errors() {
    local vm_name="$1"
    local since="${2:-5 minutes ago}"

    local errors
    errors=$(vm_ssh "$vm_name" "
        journalctl --user -b --since='$since' --no-pager 2>/dev/null \
            | grep -i 'JS ERROR' \
            | grep -i 'system-monitor' || true
    " 2>/dev/null)

    if [[ -n "$errors" ]]; then
        log_error "JS errors found:"
        echo "$errors" >&2
        return 1
    fi
    return 0
}

# Detect if GNOME Shell crashed and restarted by comparing PIDs.
# Usage: detect_crash <vm_name> <pre_pid>
# Returns 0 if no crash, 1 if crash detected.
detect_crash() {
    local vm_name="$1"
    local pre_pid="$2"

    local post_pid
    post_pid=$(vm_ssh "$vm_name" "pgrep -x gnome-shell" 2>/dev/null || echo "")

    if [[ -z "$post_pid" ]]; then
        log_error "GNOME Shell is not running (may have crashed fatally)"
        return 1
    fi

    if [[ "$pre_pid" != "$post_pid" ]]; then
        log_warn "GNOME Shell PID changed: $pre_pid -> $post_pid (crash + restart detected)"
        return 1
    fi

    return 0
}

# Run all health checks and report results.
# Usage: check_health <vm_name> [pre_pid] [since_time]
# Returns 0 if all healthy, 1 if any issues.
check_health() {
    local vm_name="$1"
    local pre_pid="${2:-}"
    local since="${3:-5 minutes ago}"
    local status=0

    # Check GNOME Shell alive
    if check_gnome_shell_alive "$vm_name"; then
        echo "GNOME Shell: running"
    else
        echo "GNOME Shell: NOT RUNNING"
        status=1
    fi

    # Check crash (if pre_pid provided)
    if [[ -n "$pre_pid" ]]; then
        if detect_crash "$vm_name" "$pre_pid"; then
            echo "Crash: none detected"
        else
            echo "Crash: GNOME Shell restarted"
            status=1
        fi
    fi

    # Check extension state
    if check_extension_active "$vm_name"; then
        echo "Extension: ACTIVE"
    else
        local ext_state
        ext_state=$(vm_ssh "$vm_name" "gnome-extensions show $EXT_UUID 2>/dev/null | grep State:" 2>/dev/null || echo "State: UNKNOWN")
        echo "Extension: $ext_state"
        status=1
    fi

    # Check JS errors
    if check_no_js_errors "$vm_name" "$since"; then
        echo "JS Errors: none"
    else
        echo "JS Errors: FOUND (see logs)"
        status=1
    fi

    return $status
}
