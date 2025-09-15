#!/usr/bin/env bash
set -euo pipefail

# Run Arch build test locally, similar to the GitHub Actions workflow.
#
# Usage:
#   ./run-local.sh

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "Building Arch test image..."
make -C "${SCRIPT_DIR}" image

echo
echo "Running Arch build test container..."

docker run --rm mgalgs/system-monitor-next-build-test-arch

echo
echo "Arch build test finished."
