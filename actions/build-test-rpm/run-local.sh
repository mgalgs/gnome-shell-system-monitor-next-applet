#!/usr/bin/env bash
set -euo pipefail

# Run Fedora RPM build tests locally, similar to the GitHub Actions workflow.
#
# Environment:
#   FEDORA_VERSIONS: space-separated list (defaults: "fc43 fc42 fc41")
#   GSSMN_SHA1: commit to build (defaults: git rev-parse HEAD from repo root)
#
# Usage:
#   ./run-local.sh
#   FEDORA_VERSIONS="fc43 fc42" ./run-local.sh

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)

FEDORA_VERSIONS=${FEDORA_VERSIONS:-"fc43 fc42 fc41"}
GSSMN_SHA1=${GSSMN_SHA1:-$(cd "${REPO_ROOT}" && git rev-parse HEAD)}
GSSMN_SOURCES=${GSSMN_SOURCES:-"${REPO_ROOT}"}

echo "Repo root: ${REPO_ROOT}"
echo "Fedora targets: ${FEDORA_VERSIONS}"
echo "Commit: ${GSSMN_SHA1}"

# Build images
for ver in ${FEDORA_VERSIONS}; do
    echo "Building image for ${ver}..."
    make -C "${SCRIPT_DIR}" "image-${ver}"
    echo "Built image mgalgs/system-monitor-next-build-test-rpm:${ver}"
    echo
    echo "Running RPM build test for ${ver}..."
    docker run --rm \
           -v "${GSSMN_SOURCES}":/source \
           -e GSSMN_SOURCES=/source \
           -e GSSMN_SHA1="${GSSMN_SHA1}" \
           "mgalgs/system-monitor-next-build-test-rpm:${ver}"
    echo "Done: ${ver}"
    echo
done

echo "All RPM build tests finished."
