#!/bin/bash
# Open the extension's tray menu inside a VM, so it can be screenshotted.
#
# Usage: source vm-common.sh; source vm-menu.sh; open_tray_menu <vm_name>
#
# The popup menu is where multi-device monitors report, and none of it is
# visible in a panel screenshot. There is no pointer channel into the guest --
# `virsh` sends key events only -- so the menu is reached the way a keyboard
# user reaches it: focus the top bar, walk to the button, press Enter.
#
# GNOME's own status area is always the last item in the panel, and this
# extension inserts itself immediately before it, so walking to the far right
# and stepping back once lands on the extension whatever else is in the panel.
# Arrow navigation stops at the ends rather than wrapping, which is what makes
# a fixed number of presses safe: press more than there are items.

# Presses used to reach the far right of the panel. Any number at or above the
# panel's item count works; the walk stops at the end.
TRAY_MENU_WALK="${TRAY_MENU_WALK:-8}"

# Send one key combination to the guest.
_send_key() {
    local vm_name="$1"
    shift
    $VIRSH send-key "$vm_name" "$@" >/dev/null
    sleep 0.4
}

# Open the extension's tray menu. Leaves it open.
# Usage: open_tray_menu <vm_name>
open_tray_menu() {
    local vm_name="$1"

    # Any menu already open would swallow the navigation keys.
    _send_key "$vm_name" KEY_ESC

    _send_key "$vm_name" KEY_LEFTCTRL KEY_LEFTALT KEY_TAB
    for ((i = 0; i < TRAY_MENU_WALK; i++)); do
        _send_key "$vm_name" KEY_RIGHT
    done
    _send_key "$vm_name" KEY_LEFT
    _send_key "$vm_name" KEY_ENTER

    # The menu animates open, and a screenshot taken during the animation shows
    # a half-drawn table.
    sleep 1
    log_ok "Tray menu opened on '$vm_name'"
}

# Close whatever menu is open.
# Usage: close_tray_menu <vm_name>
close_tray_menu() {
    local vm_name="$1"
    _send_key "$vm_name" KEY_ESC
}
