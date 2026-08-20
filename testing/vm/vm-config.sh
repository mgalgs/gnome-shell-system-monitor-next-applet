#!/bin/bash
# Push monitor configurations to a test VM.
#
# Accepts a JSON file containing an array of monitor config objects,
# or a --preset name that maps to a file in testing/vm/configs/.
#
# Usage: vm-config.sh [OPTIONS] [CONFIG_FILE]
#
# Options:
#   --vm NAME          VM to use (default: first in vms.conf)
#   --preset NAME      Use a preset from testing/vm/configs/
#   --screenshot       Take a screenshot after applying config
#   --open-menu        Open the extension's tray menu before screenshotting
#   --label LABEL      Label for screenshot file (default: preset/file name)
#   --list-presets     List available preset names
#
# Examples:
#   vm-config.sh --preset all-visible
#   vm-config.sh --preset prometheus --screenshot
#   vm-config.sh my-config.json
#   vm-config.sh --vm gssmn-fedora42 --preset minimal --screenshot

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIGS_DIR="$SCRIPT_DIR/configs"

source "$SCRIPT_DIR/lib/vm-common.sh"
source "$SCRIPT_DIR/lib/vm-screenshot.sh"
source "$SCRIPT_DIR/lib/vm-menu.sh"

TARGET_VM=""
PRESET=""
CONFIG_FILE=""
SCREENSHOT=false
OPEN_MENU=false
LABEL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        --preset) PRESET="$2"; shift 2 ;;
        --screenshot) SCREENSHOT=true; shift ;;
        --open-menu) OPEN_MENU=true; shift ;;
        --label) LABEL="$2"; shift 2 ;;
        --list-presets)
            echo "Available presets:"
            for f in "$CONFIGS_DIR"/*.json; do
                name=$(basename "$f" .json)
                desc=$(python3 -c "
import json, sys
with open('$f') as fh:
    data = json.load(fh)
desc = data.get('description', '')
print(desc)
" 2>/dev/null || true)
                printf "  %-20s %s\n" "$name" "$desc"
            done
            exit 0
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS] [CONFIG_FILE]"
            echo ""
            echo "Push monitor configurations to a test VM."
            echo ""
            echo "Options:"
            echo "  --vm NAME          VM to use (default: first in vms.conf)"
            echo "  --preset NAME      Use a preset from testing/vm/configs/"
            echo "  --screenshot       Take a screenshot after applying"
            echo "  --open-menu        Open the tray menu before screenshotting"
            echo "  --label LABEL      Label for screenshot (default: config name)"
            echo "  --list-presets     List available presets"
            echo ""
            echo "Examples:"
            echo "  $0 --preset all-visible"
            echo "  $0 --preset prometheus --screenshot"
            echo "  $0 my-config.json --screenshot"
            echo "  $0 --preset all-cores --open-menu --screenshot"
            exit 0
            ;;
        -*) log_error "Unknown option: $1"; exit 2 ;;
        *) CONFIG_FILE="$1"; shift ;;
    esac
done

# Resolve config file
if [[ -n "$PRESET" ]]; then
    CONFIG_FILE="$CONFIGS_DIR/${PRESET}.json"
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Preset '$PRESET' not found at $CONFIG_FILE"
        echo "Available presets:"
        ls "$CONFIGS_DIR"/*.json 2>/dev/null | xargs -I{} basename {} .json | sed 's/^/  /'
        exit 2
    fi
    [[ -z "$LABEL" ]] && LABEL="$PRESET"
elif [[ -z "$CONFIG_FILE" ]]; then
    log_error "Provide a config file or --preset NAME"
    exit 2
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
    log_error "Config file not found: $CONFIG_FILE"
    exit 2
fi

[[ -z "$LABEL" ]] && LABEL=$(basename "$CONFIG_FILE" .json)

# Resolve VM
if [[ -z "$TARGET_VM" ]]; then
    TARGET_VM=$(vm_default_name)
fi
vm_parse_config "$TARGET_VM"

if ! vm_is_running "$TARGET_VM"; then
    log_error "VM '$TARGET_VM' is not running"
    exit 2
fi

# Copy JSON + apply script to VM, run remotely (avoids shell-escaping double quotes)
log_info "Pushing config '$LABEL' to $TARGET_VM..."

APPLY_SCRIPT="$SCRIPT_DIR/lib/apply-config.py"
vm_rsync "$TARGET_VM" "$CONFIG_FILE" "/tmp/_sm_config.json"
vm_rsync "$TARGET_VM" "$APPLY_SCRIPT" "/tmp/_sm_apply.py"
vm_ssh "$TARGET_VM" "python3 /tmp/_sm_apply.py /tmp/_sm_config.json"
log_ok "Config applied"

if $OPEN_MENU; then
    # Widgets fill their menu cells on their own refresh tick, so a menu opened
    # the instant the config lands shows a table that is still filling in.
    sleep 3
    open_tray_menu "$TARGET_VM"
fi

if $SCREENSHOT; then
    if ! $OPEN_MENU; then
        sleep 3
    fi
    SCREENSHOT_PATH=$(take_screenshot "$TARGET_VM" "$LABEL")
    log_ok "Screenshot: $SCREENSHOT_PATH"
fi
