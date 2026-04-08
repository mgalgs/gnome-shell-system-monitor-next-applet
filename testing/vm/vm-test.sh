#!/bin/bash
# Main entry point for VM-based extension testing.
# Deploys the extension to a test VM, takes screenshots, captures logs,
# and reports pass/fail status.
#
# Usage: vm-test.sh [OPTIONS]
#
# Options:
#   --vm NAME          VM to use (default: first in vms.conf)
#   --no-restore       Skip snapshot restore (faster iteration)
#   --screenshot-only  Just take a screenshot of current VM state
#   --logs-only        Just capture logs from current VM state
#   --label LABEL      Label for output files (default: "test")
#   --timeout SECS     Max wait time for SSH (default: 180)
#   --create           Create the VM first if it doesn't exist
#
# Exit codes:
#   0 = PASS (extension loaded, no errors)
#   1 = FAIL (extension error, crash, or JS errors)
#   2 = INFRA (VM/SSH/infrastructure problem)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/vm-common.sh"
source "$SCRIPT_DIR/lib/vm-snapshot.sh"
source "$SCRIPT_DIR/lib/vm-deploy.sh"
source "$SCRIPT_DIR/lib/vm-screenshot.sh"
source "$SCRIPT_DIR/lib/vm-logs.sh"
source "$SCRIPT_DIR/lib/vm-health.sh"

# --- Argument parsing ---
TARGET_VM=""
NO_RESTORE=false
SCREENSHOT_ONLY=false
LOGS_ONLY=false
LABEL="test"
TIMEOUT=180
CREATE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        --no-restore) NO_RESTORE=true; shift ;;
        --screenshot-only) SCREENSHOT_ONLY=true; shift ;;
        --logs-only) LOGS_ONLY=true; shift ;;
        --label) LABEL="$2"; shift 2 ;;
        --timeout) TIMEOUT="$2"; shift 2 ;;
        --create) CREATE=true; shift ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Deploy and test the extension in a VM."
            echo ""
            echo "Options:"
            echo "  --vm NAME          VM to use (default: first in vms.conf)"
            echo "  --no-restore       Skip snapshot restore (faster iteration)"
            echo "  --screenshot-only  Just take a screenshot"
            echo "  --logs-only        Just capture logs"
            echo "  --label LABEL      Label for output files (default: test)"
            echo "  --timeout SECS     SSH timeout (default: 180)"
            echo "  --create           Create VM if it doesn't exist"
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 2 ;;
    esac
done

# Determine VM
if [[ -z "$TARGET_VM" ]]; then
    TARGET_VM=$(vm_default_name)
fi

vm_parse_config "$TARGET_VM"

START_TIME=$(date +%s)
TEST_START_TIME=$(date '+%Y-%m-%d %H:%M:%S')

echo ""
log_info "=========================================="
log_info "VM Test: $VM_NAME (GNOME $VM_GNOME_VERSION)"
log_info "Label: $LABEL"
log_info "=========================================="

# --- Ensure VM exists ---
if ! vm_exists "$VM_NAME"; then
    if $CREATE; then
        log_info "VM does not exist, creating..."
        "$SCRIPT_DIR/vm-create.sh" --vm "$VM_NAME"
    else
        log_error "VM '$VM_NAME' does not exist. Run: vm-create.sh --vm $VM_NAME"
        log_error "Or use: vm-test.sh --create --vm $VM_NAME"
        exit 2
    fi
fi

# --- Screenshot-only mode ---
if $SCREENSHOT_ONLY; then
    if ! vm_is_running "$VM_NAME"; then
        log_error "VM is not running"
        exit 2
    fi
    SCREENSHOT_PATH=$(take_screenshot "$VM_NAME" "$LABEL")
    echo ""
    echo "=== Screenshot ==="
    echo "Screenshot: $SCREENSHOT_PATH"
    exit 0
fi

# --- Logs-only mode ---
if $LOGS_ONLY; then
    if ! vm_is_running "$VM_NAME"; then
        log_error "VM is not running"
        exit 2
    fi
    LOG_PATH=$(capture_logs "$VM_NAME" "$LABEL" "$TEST_START_TIME")
    echo ""
    echo "=== Logs ==="
    echo "Logs: $LOG_PATH"
    exit 0
fi

# --- Full test workflow ---

# Step 1: Restore snapshot (unless --no-restore)
if ! $NO_RESTORE; then
    if snapshot_exists "$VM_NAME"; then
        snapshot_restore "$VM_NAME"
    else
        log_warn "No snapshot found, using current VM state"
        if ! vm_is_running "$VM_NAME"; then
            log_info "Starting VM..."
            $VIRSH start "$VM_NAME"
        fi
    fi
else
    if ! vm_is_running "$VM_NAME"; then
        log_info "Starting VM..."
        $VIRSH start "$VM_NAME"
    fi
fi

# Step 2: Wait for SSH
vm_wait_ssh "$VM_NAME" "$TIMEOUT" || {
    log_error "SSH not available — infrastructure problem"
    exit 2
}

# Step 3: Record pre-deploy state
TEST_START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
PRE_PID=$(vm_ssh "$VM_NAME" "pgrep -x gnome-shell" 2>/dev/null || true)

if [[ -z "$PRE_PID" ]]; then
    log_warn "GNOME Shell not running before deploy — session may not be ready"
    sleep 15
    PRE_PID=$(vm_ssh "$VM_NAME" "pgrep -x gnome-shell" 2>/dev/null || true)
fi

# Step 4: Deploy extension
deploy_extension "$VM_NAME"

# Re-record PID after deploy (GDM may have been restarted for first-time extension discovery)
PRE_PID=$(vm_ssh "$VM_NAME" "pgrep -x gnome-shell" 2>/dev/null || echo "unknown")

# Step 5: Run health checks
echo ""
log_info "Running health checks..."
HEALTH_OUTPUT=$(check_health "$VM_NAME" "$PRE_PID" "$TEST_START_TIME" 2>&1) || true

# Step 6: Take screenshot
SCREENSHOT_PATH=$(take_screenshot "$VM_NAME" "$LABEL") || SCREENSHOT_PATH="(screenshot failed)"

# Step 7: Capture logs
LOG_PATH=$(capture_logs "$VM_NAME" "$LABEL" "$TEST_START_TIME") || LOG_PATH="(log capture failed)"

# --- Report results ---
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if echo "$HEALTH_OUTPUT" | grep -qE 'NOT RUNNING|FOUND|restarted|UNKNOWN|ERROR'; then
    STATUS="FAIL"
    EXIT_CODE=1
else
    STATUS="PASS"
    EXIT_CODE=0
fi

echo ""
echo "=== VM Test Results ==="
echo "VM: $VM_NAME (GNOME $VM_GNOME_VERSION)"
echo "Status: $STATUS"
echo "$HEALTH_OUTPUT"
echo "Screenshot: $SCREENSHOT_PATH"
echo "Logs: $LOG_PATH"
echo "Duration: ${DURATION}s"

exit $EXIT_CODE
