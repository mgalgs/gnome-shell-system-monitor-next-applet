#!/usr/bin/env bash
#
# check-shexli.sh -- run shexli over the release zip and gate on its findings.
#
# shexli exits 0 even when it reports errors and offers no --strict flag, so
# invoking it directly can never fail a build. This runs it with --format
# json and exits non-zero when an error-severity finding is present.
#
# Usage:
#   scripts/check-shexli.sh <zipfile>
#
set -euo pipefail

# Rule IDs that must not fail the build, each with the reason it is waived.
# A waiver that stops firing is itself an error, so this list cannot outlive
# the problem it works around.
#
# EGO-M-004: shexli hardcodes `major > 50` as an implausible future release,
# so it rejects the GNOME Shell 51 entry metadata.json legitimately declares.
WAIVED_RULES=(EGO-M-004)

say() { printf '  [%-12s] %s\n' 'check.shexli' "$1"; }
die() { printf '  [%-12s] ERROR: %s\n' 'check.shexli' "$1" >&2; exit 1; }

if [[ $# -ne 1 || $1 == -h || $1 == --help ]]; then
    printf 'Usage: %s <zipfile>\n' "$0"
    [[ $# -eq 1 ]] && exit 0
    exit 1
fi

zipfile="$1"
[[ -f "$zipfile" ]] || die "no such file: $zipfile"

say 'Running shexli...'

report="$(mktemp)"
trap 'rm -f "$report"' EXIT

# Let a shexli crash fail the build rather than read as "no findings".
if ! uv run --with shexli --with 'tree-sitter<0.26' \
     --python 3.13 --managed-python \
     shexli --format json "$zipfile" > "$report"; then
    die 'shexli failed to run'
fi

# The report arrives by path: stdin carries this script.
python3 - "$report" "${WAIVED_RULES[@]}" <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    report = json.load(handle)
waived = set(sys.argv[2:])


def say(msg):
    print(f'  [{"check.shexli":<12}] {msg}')


findings = report.get('findings', [])
blocking = []
seen_waived = set()

for finding in findings:
    rule = finding.get('rule_id', '?')
    severity = finding.get('severity', '?')
    if rule in waived:
        seen_waived.add(rule)
        say(f'WAIVED {rule} ({severity}): {finding.get("message", "")}')
        continue
    if severity == 'error':
        blocking.append(finding)
    say(f'{rule} ({severity}): {finding.get("message", "")}')
    for evidence in finding.get('evidence', []):
        say(f'    {evidence.get("path", "")}: {evidence.get("snippet", "")}')

# A waiver whose rule no longer fires has outlived its reason. Fail loudly so
# it gets deleted instead of quietly suppressing a future real finding.
stale = sorted(waived - seen_waived)
for rule in stale:
    say(f'STALE WAIVER {rule}: no longer reported')
if stale:
    say(f'Remove {", ".join(stale)} from WAIVED_RULES in scripts/check-shexli.sh')

if blocking:
    say(f'{len(blocking)} blocking finding(s)')

sys.exit(1 if blocking or stale else 0)
PY
