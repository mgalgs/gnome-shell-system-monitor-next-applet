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

TARGET_VM=""
PRESET=""
CONFIG_FILE=""
SCREENSHOT=false
LABEL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vm) TARGET_VM="$2"; shift 2 ;;
        --preset) PRESET="$2"; shift 2 ;;
        --screenshot) SCREENSHOT=true; shift ;;
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
            echo "  --label LABEL      Label for screenshot (default: config name)"
            echo "  --list-presets     List available presets"
            echo ""
            echo "Examples:"
            echo "  $0 --preset all-visible"
            echo "  $0 --preset prometheus --screenshot"
            echo "  $0 my-config.json --screenshot"
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

# Convert JSON config to GVariant string array and push via gsettings
log_info "Pushing config '$LABEL' to $TARGET_VM..."

# The JSON file has a top-level object with "monitors" array (and optional metadata).
# Each monitor is a JSON object that gets serialized as a string element in the GSettings array.
GVARIANT=$(python3 -c "
import json, sys

with open('$CONFIG_FILE') as f:
    data = json.load(f)

monitors = data.get('monitors', data) if isinstance(data, dict) else data

parts = []
for m in monitors:
    s = json.dumps(m, separators=(',', ':'))
    # Escape single quotes for GVariant string
    s = s.replace(\"'\", \"'\\\\''\" )
    parts.append(\"'\" + s + \"'\")

print('[' + ', '.join(parts) + ']')
")

vm_ssh "$TARGET_VM" "gsettings set org.gnome.shell.extensions.system-monitor-next-applet monitors \"$GVARIANT\""
log_ok "Config applied"

# Also push global settings if present
GLOBALS=$(python3 -c "
import json
with open('$CONFIG_FILE') as f:
    data = json.load(f)
settings = data.get('settings', {})
for k, v in settings.items():
    if isinstance(v, bool):
        print(f'{k} {str(v).lower()}')
    elif isinstance(v, int):
        print(f'{k} {v}')
    elif isinstance(v, str):
        print(f'{k} {v}')
" 2>/dev/null || true)

if [[ -n "$GLOBALS" ]]; then
    while IFS= read -r line; do
        key=$(echo "$line" | cut -d' ' -f1)
        val=$(echo "$line" | cut -d' ' -f2-)
        vm_ssh "$TARGET_VM" "gsettings set org.gnome.shell.extensions.system-monitor-next-applet $key $val"
        log_info "Set $key = $val"
    done <<< "$GLOBALS"
fi

if $SCREENSHOT; then
    sleep 3
    SCREENSHOT_PATH=$(take_screenshot "$TARGET_VM" "$LABEL")
    log_ok "Screenshot: $SCREENSHOT_PATH"
fi
