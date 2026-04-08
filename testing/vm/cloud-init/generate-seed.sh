#!/bin/bash
# Generate a cloud-init seed ISO from user-data and meta-data templates.
# Substitutes SSH_PUBKEY_PLACEHOLDER with the actual public key.
#
# Usage: generate-seed.sh <output.iso> <ssh-pubkey-file>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <output.iso> <ssh-pubkey-file>" >&2
    exit 1
fi

OUTPUT_ISO="$1"
SSH_PUBKEY_FILE="$2"

if [[ ! -f "$SSH_PUBKEY_FILE" ]]; then
    echo "Error: SSH public key file not found: $SSH_PUBKEY_FILE" >&2
    exit 1
fi

SSH_PUBKEY="$(cat "$SSH_PUBKEY_FILE")"

# Create temp dir for seed files
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Substitute SSH key placeholder into user-data
awk -v key="$SSH_PUBKEY" '{gsub(/SSH_PUBKEY_PLACEHOLDER/, key); print}' \
    "$SCRIPT_DIR/user-data.yaml" > "$TMPDIR/user-data"

# Copy meta-data as-is
cp "$SCRIPT_DIR/meta-data.yaml" "$TMPDIR/meta-data"

# Generate ISO with cidata volume label (required by cloud-init)
genisoimage -output "$OUTPUT_ISO" \
    -volid cidata \
    -joliet -rock \
    -quiet \
    "$TMPDIR/user-data" "$TMPDIR/meta-data"

echo "Seed ISO created: $OUTPUT_ISO"
