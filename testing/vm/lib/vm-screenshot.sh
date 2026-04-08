#!/bin/bash
# Take a screenshot of a VM's display via virsh and convert to PNG.
#
# Usage: source vm-common.sh; take_screenshot <vm_name> <label>
# Outputs the path to the PNG file.

# Take a screenshot and convert to PNG.
# Prints the absolute path of the resulting PNG to stdout.
take_screenshot() {
    local vm_name="$1"
    local label="${2:-screenshot}"
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)

    local ppm_file="$RESULTS_DIR/${vm_name}_${label}_${timestamp}.ppm"
    local png_file="$RESULTS_DIR/${vm_name}_${label}_${timestamp}.png"

    mkdir -p "$RESULTS_DIR"

    if ! vm_is_running "$vm_name"; then
        log_error "Cannot screenshot: VM '$vm_name' is not running"
        return 1
    fi

    $VIRSH screenshot "$vm_name" --file "$ppm_file" &>/dev/null

    if [[ ! -f "$ppm_file" ]]; then
        log_error "virsh screenshot failed — no file produced"
        return 1
    fi

    # Convert PPM to PNG
    magick "$ppm_file" "$png_file" 2>/dev/null
    rm -f "$ppm_file"

    if [[ -f "$png_file" ]]; then
        log_ok "Screenshot saved: $png_file"
        echo "$png_file"
    else
        log_error "Image conversion failed"
        return 1
    fi
}
