#!/bin/bash
# List all configured VMs and their libvirt status.
# Usage: ./vm-list.sh

source "$(dirname "${BASH_SOURCE[0]}")/lib/vm-common.sh"

printf "%-20s %-8s %-12s %-10s %s\n" "VM NAME" "GNOME" "OS VARIANT" "STATUS" "SNAPSHOT"
printf "%-20s %-8s %-12s %-10s %s\n" "-------" "-----" "----------" "------" "--------"

while IFS='|' read -r name os_variant gnome_ver _url _vcpus _ram _disk _port; do
    # Get libvirt status
    if vm_exists "$name"; then
        if vm_is_running "$name"; then
            status="running"
        else
            status="stopped"
        fi
    else
        status="-"
    fi

    # Check for clean snapshot
    if $VIRSH snapshot-info "$name" "$SNAPSHOT_NAME" &>/dev/null; then
        snapshot="yes"
    else
        snapshot="-"
    fi

    printf "%-20s %-8s %-12s %-10s %s\n" "$name" "$gnome_ver" "$os_variant" "$status" "$snapshot"
done < <(grep -v '^#' "$VMSCONF" | grep -v '^$')
