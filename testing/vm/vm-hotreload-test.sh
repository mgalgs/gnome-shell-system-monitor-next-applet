#!/bin/bash
# Test that GNOME Shell survives rapid disable/enable cycles of the extension.
#
# This exercises the exact code path where async callbacks (timers, file I/O,
# subprocess results) can fire on destroyed actors during the window between
# disable() destroying widgets and their GLib sources being removed.
#
# We use `gnome-extensions disable/enable` which is the same mechanism used
# by EGO updates and `gnome-extensions install --force`.  Plain file
# overwrites (rsync, cp) do NOT trigger GNOME Shell to reload — we verified
# this empirically.
#
# Usage: vm-hotreload-test.sh [--vm NAME] [--cycles N]
#
# Exit codes:
#   0 = PASS  (shell survived all cycles, no errors)
#   1 = FAIL  (shell crashed or errors found)
#   2 = INFRA (VM/SSH problem)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/vm-common.sh
source "$SCRIPT_DIR/lib/vm-common.sh"
# shellcheck source=lib/vm-snapshot.sh
source "$SCRIPT_DIR/lib/vm-snapshot.sh"
# shellcheck source=lib/vm-deploy.sh
source "$SCRIPT_DIR/lib/vm-deploy.sh"

# --- Argument parsing ---
TARGET_VM=""
CYCLES=10

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        --cycles) CYCLES="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--vm NAME] [--cycles N]"
            echo ""
            echo "Test that GNOME Shell survives rapid disable/enable cycles."
            echo ""
            echo "Options:"
            echo "  --vm NAME    VM to use (default: first in vms.conf)"
            echo "  --cycles N   Number of disable/enable cycles (default: 10)"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

VM_NAME="${TARGET_VM:-$(vm_list_names | head -1)}"
if [[ -z "$VM_NAME" ]]; then
    log_error "No VM specified and none found in vms.conf"
    exit 2
fi

# ---------------------------------------------------------------
# Step 1: Restore snapshot and deploy the extension normally
# ---------------------------------------------------------------
log_info "=== Step 1: Clean deploy ==="

if snapshot_exists "$VM_NAME"; then
    snapshot_restore "$VM_NAME"
else
    log_error "No snapshot for VM '$VM_NAME' — run: make vm-create VM=$VM_NAME"
    exit 2
fi

vm_wait_ssh "$VM_NAME" 120 || { log_error "SSH not available"; exit 2; }

deploy_extension "$VM_NAME"

# Reboot so GNOME Shell loads the new JS modules from a cold start
log_info "Rebooting VM to load fresh JS modules..."
vm_ssh "$VM_NAME" "sudo reboot" || true
sleep 5
vm_wait_session "$VM_NAME" 120 || { log_error "GNOME session not ready after reboot"; exit 2; }

# Let the extension settle (timers start, sensors enumerated, etc.)
sleep 10

# Verify the extension is healthy before we start cycling
PRE_PID=$(vm_ssh "$VM_NAME" "pgrep -x gnome-shell" 2>/dev/null || true)
if [[ -z "$PRE_PID" ]]; then
    log_error "GNOME Shell not running after deploy+reboot"
    exit 2
fi

EXT_STATE=$(vm_ssh "$VM_NAME" "gnome-extensions show $EXT_UUID 2>/dev/null | grep State:" || true)
if ! echo "$EXT_STATE" | grep -q "ACTIVE"; then
    log_error "Extension not active after deploy: $EXT_STATE"
    exit 1
fi

log_ok "Extension running (gnome-shell PID=$PRE_PID)"

# Push a config with many widgets to maximize async callback pressure
log_info "Pushing all-visible config for maximum timer coverage..."
"$SCRIPT_DIR/vm-config.sh" --vm "$VM_NAME" --preset all-visible 2>&1 | tail -3
sleep 5

# Mark the log position so we only check errors from here on
CYCLE_TIME=$(vm_ssh "$VM_NAME" "date '+%Y-%m-%d %H:%M:%S'")

# ---------------------------------------------------------------
# Step 2: Rapid disable/enable cycles
# ---------------------------------------------------------------
log_info "=== Step 2: Disable/enable x${CYCLES} ==="

for i in $(seq 1 "$CYCLES"); do
    # Check shell is still alive before each cycle
    CUR_PID=$(vm_ssh "$VM_NAME" "pgrep -x gnome-shell" 2>/dev/null || true)
    if [[ -z "$CUR_PID" ]]; then
        log_error "GNOME Shell died before cycle #$i (was PID $PRE_PID)"
        break
    fi
    if [[ "$CUR_PID" != "$PRE_PID" ]]; then
        log_error "GNOME Shell PID changed before cycle #$i: $PRE_PID -> $CUR_PID"
        PRE_PID="$CUR_PID"
    fi

    log_info "Cycle #$i/$CYCLES: disable → enable..."
    vm_ssh "$VM_NAME" "gnome-extensions disable $EXT_UUID 2>/dev/null" || true
    # Short gap — just enough that timers can fire in the destruction window
    sleep 1
    vm_ssh "$VM_NAME" "gnome-extensions enable $EXT_UUID 2>/dev/null" || true
    # Let the extension settle before the next round
    sleep 3
done

log_info "Waiting for final cycle to settle..."
sleep 5

# ---------------------------------------------------------------
# Step 3: Check results
# ---------------------------------------------------------------
log_info "=== Step 3: Health check ==="

STATUS="PASS"
EXIT_CODE=0

# 3a: Is gnome-shell still running with the same PID?
POST_PID=$(vm_ssh "$VM_NAME" "pgrep -x gnome-shell" 2>/dev/null || true)
if [[ -z "$POST_PID" ]]; then
    log_error "GNOME Shell is NOT RUNNING after cycling (crashed)"
    STATUS="FAIL"
    EXIT_CODE=1
elif [[ "$PRE_PID" != "$POST_PID" ]]; then
    log_error "GNOME Shell PID changed: $PRE_PID -> $POST_PID (crash + auto-restart)"
    STATUS="FAIL"
    EXIT_CODE=1
else
    log_ok "GNOME Shell survived (PID=$POST_PID unchanged)"
fi

# 3b: Is the extension still active?
EXT_STATE=$(vm_ssh "$VM_NAME" "gnome-extensions show $EXT_UUID 2>/dev/null | grep State:" || true)
if echo "$EXT_STATE" | grep -q "ACTIVE"; then
    log_ok "Extension: ACTIVE"
else
    log_error "Extension state after cycling: $EXT_STATE"
    STATUS="FAIL"
    EXIT_CODE=1
fi

# 3c: Check for "already disposed" errors (the exact crash signature)
DISPOSED_ERRORS=$(vm_ssh "$VM_NAME" "
    journalctl --user -b --since='$CYCLE_TIME' --no-pager 2>/dev/null \
        | grep -c 'already disposed' || true
" 2>/dev/null)

if [[ "$DISPOSED_ERRORS" -gt 0 ]]; then
    log_error "Found $DISPOSED_ERRORS 'already disposed' errors"
    STATUS="FAIL"
    EXIT_CODE=1
else
    log_ok "No 'already disposed' errors"
fi

# 3d: Check for JS errors from the extension
JS_ERRORS=$(vm_ssh "$VM_NAME" "
    journalctl --user -b --since='$CYCLE_TIME' --no-pager 2>/dev/null \
        | grep -i 'JS ERROR' | grep -i 'system-monitor' || true
" 2>/dev/null)

if [[ -n "$JS_ERRORS" ]]; then
    log_error "JS errors found:"
    echo "$JS_ERRORS" >&2
    STATUS="FAIL"
    EXIT_CODE=1
else
    log_ok "No JS errors"
fi

# 3e: Dump all extension-related log lines for inspection
log_info "Extension log output during cycling:"
vm_ssh "$VM_NAME" "
    journalctl --user -b --since='$CYCLE_TIME' --no-pager 2>/dev/null \
        | grep -i 'system-monitor\|already disposed\|JS ERROR' || echo '  (none)'
" 2>/dev/null || true

# --- Summary ---
echo ""
echo "=== Disable/Enable Cycle Test Result ==="
echo "VM:     $VM_NAME"
echo "Cycles: $CYCLES"
echo "Status: $STATUS"
echo "PID:    $PRE_PID -> ${POST_PID:-(dead)}"
echo "Extension: $EXT_STATE"
echo "Disposed errors: $DISPOSED_ERRORS"

exit "$EXIT_CODE"
