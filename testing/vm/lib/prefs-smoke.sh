#!/bin/bash
# Open the extension's preferences window and report whether it came up.
# Runs on the VM. Usage: prefs-smoke.sh <extension-uuid>
#
# Preferences runs in its own process (org.gnome.Shell.Extensions), which no
# other health check ever starts, so a fault confined to prefs.js -- a gettext
# call at module scope, a bad import, a typo in a widget property -- leaves
# gnome-shell perfectly healthy and every shell-side check green.
#
# Prints "PREFS_OK" or "PREFS_FAIL" followed by whatever went wrong.

set -uo pipefail
UUID="${1:?extension uuid}"
PATTERN="org.gnome.Shell.Extensions"

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

# pkill -f would match this script's own command line; match the binary's args
# only via pgrep on the full line, excluding our own pid.
kill_prefs() {
    for pid in $(pgrep -f "$PATTERN" 2>/dev/null); do
        [ "$pid" = "$$" ] && continue
        kill "$pid" 2>/dev/null
    done
}

kill_prefs
sleep 1

BEFORE=$(mktemp)
journalctl --user -b --no-pager > "$BEFORE" 2>/dev/null

gnome-extensions prefs "$UUID" >/dev/null 2>&1
sleep 6

ERRORS=$(journalctl --user -b --no-pager 2>/dev/null \
    | grep -vxF -f "$BEFORE" 2>/dev/null \
    | grep -iE "Failed to open preferences|JS ERROR" \
    | head -10)

ALIVE=0
for pid in $(pgrep -f "$PATTERN" 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    ALIVE=$((ALIVE + 1))
done

kill_prefs
rm -f "$BEFORE"

if [ -n "$ERRORS" ]; then
    echo "PREFS_FAIL"
    echo "$ERRORS"
    exit 1
fi
if [ "$ALIVE" -eq 0 ]; then
    echo "PREFS_FAIL"
    echo "preferences process did not stay running"
    exit 1
fi
echo "PREFS_OK"
