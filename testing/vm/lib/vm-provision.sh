#!/bin/bash
# Post-boot VM provisioning: installs GNOME desktop, extension dependencies,
# configures auto-login, disables screen lock/idle, and reboots into graphical session.
#
# Usage: vm-provision.sh <vm_name>
# Called by vm-create.sh after cloud-init completes.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/vm-common.sh"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <vm_name>" >&2
    exit 1
fi

VM_NAME="$1"

log_info "Provisioning VM '$VM_NAME'..."

# Detect distro family
DISTRO=$(vm_ssh "$VM_NAME" "source /etc/os-release && echo \$ID")
log_info "Detected distro: $DISTRO"

case "$DISTRO" in
    fedora)
        log_info "Installing GNOME desktop and extension dependencies (this may take several minutes)..."
        vm_ssh "$VM_NAME" "sudo dnf install -y @gnome-desktop libgtop2-devel NetworkManager-libnm-devel gnome-extensions-app gnome-shell-extension-common glib2-devel 2>&1 | tail -5"

        log_info "Configuring GDM auto-login..."
        vm_ssh "$VM_NAME" "sudo mkdir -p /etc/gdm && printf '[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=testuser\nWaylandEnable=true\n\n[security]\n\n[xdmcp]\n\n[chooser]\n\n[debug]\n' | sudo tee /etc/gdm/custom.conf > /dev/null"

        log_info "Setting graphical target..."
        vm_ssh "$VM_NAME" "sudo systemctl set-default graphical.target"
        vm_ssh "$VM_NAME" "sudo systemctl enable gdm"
        ;;

    debian|ubuntu)
        log_info "Installing GNOME desktop and extension dependencies..."
        vm_ssh "$VM_NAME" "sudo apt-get update -qq && sudo apt-get install -y -qq gnome-session gnome-shell gdm3 gir1.2-gtop-2.0 gir1.2-nm-1.0 gnome-shell-extension-prefs glib-networking 2>&1 | tail -5"

        log_info "Configuring GDM auto-login..."
        vm_ssh "$VM_NAME" "sudo mkdir -p /etc/gdm3 && printf '[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=testuser\nWaylandEnable=true\n\n[security]\n\n[xdmcp]\n\n[chooser]\n\n[debug]\n' | sudo tee /etc/gdm3/custom.conf > /dev/null"

        log_info "Setting graphical target..."
        vm_ssh "$VM_NAME" "sudo systemctl set-default graphical.target"
        vm_ssh "$VM_NAME" "sudo systemctl enable gdm3"
        ;;

    *)
        log_error "Unsupported distro: $DISTRO"
        exit 1
        ;;
esac

# Reboot into graphical session
log_info "Rebooting VM into graphical session..."
vm_ssh "$VM_NAME" "sudo reboot" || true  # reboot kills the SSH connection

# Wait for the VM to come back with SSH
sleep 10
vm_wait_ssh "$VM_NAME" 300

# Wait for GNOME Shell to start (GDM auto-login needs a moment)
log_info "Waiting for GNOME Shell to start..."
gs_timeout=120
gs_elapsed=0
while [[ $gs_elapsed -lt $gs_timeout ]]; do
    if vm_ssh "$VM_NAME" "pgrep -x gnome-shell" &>/dev/null; then
        log_ok "GNOME Shell is running"
        break
    fi
    sleep 5
    gs_elapsed=$((gs_elapsed + 5))
done

if [[ $gs_elapsed -ge $gs_timeout ]]; then
    log_error "GNOME Shell did not start within ${gs_timeout}s"
    exit 1
fi

# Give GNOME Shell a few more seconds to fully initialize
sleep 10

# Disable screen lock, idle timeout, and notifications
log_info "Configuring GNOME session settings..."
vm_ssh "$VM_NAME" "gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null; gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null; gsettings set org.gnome.desktop.notifications show-banners false 2>/dev/null; gsettings set org.gnome.desktop.screensaver idle-activation-enabled false 2>/dev/null" || true

log_info "Verifying GNOME Shell version..."
GNOME_VERSION=$(vm_ssh "$VM_NAME" "gnome-shell --version" 2>/dev/null || echo "unknown")
log_ok "Provisioning complete. GNOME Shell version: $GNOME_VERSION"
