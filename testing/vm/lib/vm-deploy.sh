#!/bin/bash
# Build the extension zip and deploy it to a test VM via gnome-extensions install.
# This mirrors the end-user install path (extensions.gnome.org / manual zip install).
#
# Usage: source vm-common.sh; deploy_extension <vm_name>

# Build the extension zip and deploy to VM.
# Returns 0 on success, 1 on failure.
deploy_extension() {
    local vm_name="$1"

    # Build zip locally
    log_info "Building extension zip..."
    make -C "$PROJECT_ROOT" zip-file V=0 2>&1 | tail -3
    log_ok "Zip built"

    local zipfile="$PROJECT_ROOT/dist/${EXT_UUID}.zip"
    if [[ ! -f "$zipfile" ]]; then
        log_err "Zip file not found: $zipfile"
        return 1
    fi

    # Copy zip to VM and install
    log_info "Deploying extension to VM..."
    local port
    port=$(vm_get_ssh_port "$vm_name")
    scp $SSH_OPTS -i "$SSH_KEY" -P "$port" "$zipfile" "${SSH_USER}@localhost:/tmp/${EXT_UUID}.zip"
    vm_ssh "$vm_name" "gnome-extensions install --force /tmp/${EXT_UUID}.zip"
    log_ok "Extension installed from zip"

    # Compile schemas system-wide (some GNOME versions need this)
    log_info "Compiling schemas..."
    vm_ssh "$vm_name" "sudo cp ~/.local/share/gnome-shell/extensions/$EXT_UUID/schemas/*.gschema.xml /usr/share/glib-2.0/schemas/ 2>/dev/null && sudo glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null" || true

    # Check if extension is known to GNOME Shell
    local ext_known
    ext_known=$(vm_ssh "$vm_name" "gnome-extensions show $EXT_UUID 2>&1 || true")

    if echo "$ext_known" | grep -q "doesn't exist"; then
        # Extension not yet known — GNOME Shell needs a restart to discover it.
        # Restart GDM to get a fresh session with auto-login.
        log_info "Extension not yet known to GNOME Shell, restarting GDM to discover it..."
        vm_ssh "$vm_name" "sudo systemctl restart gdm" || true
        sleep 5

        # Wait for GNOME Shell to come back (GDM auto-login creates new session)
        local gs_timeout=60
        local gs_elapsed=0
        while [[ $gs_elapsed -lt $gs_timeout ]]; do
            if vm_ssh "$vm_name" "pgrep -x gnome-shell" &>/dev/null; then
                log_ok "GNOME Shell restarted"
                break
            fi
            sleep 3
            gs_elapsed=$((gs_elapsed + 3))
        done
        sleep 5  # Let GNOME Shell fully initialize
    fi

    # Enable extension
    log_info "Enabling extension..."
    vm_ssh "$vm_name" "gnome-extensions enable $EXT_UUID 2>/dev/null" || true

    # Reload: disable then re-enable (Wayland-safe, picks up code changes)
    log_info "Reloading extension..."
    vm_ssh "$vm_name" "gnome-extensions disable $EXT_UUID 2>/dev/null; sleep 2; gnome-extensions enable $EXT_UUID 2>/dev/null" || true

    # Wait for extension to settle
    sleep 5
    log_ok "Extension deployed and enabled"
}
