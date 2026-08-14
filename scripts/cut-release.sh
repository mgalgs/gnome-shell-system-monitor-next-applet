#!/usr/bin/env bash
#
# cut-release.sh -- cut a system-monitor-next release.
#
# Derives the version, runs every release check, builds and verifies the
# zip, then creates and pushes a signed tag. The only step left to a human
# is the extensions.gnome.org upload, which needs an EGO login.
#
# Usage:
#   scripts/cut-release.sh [--dry-run] [VERSION]
#
#   VERSION    release number N for tag v3.N (e.g. 36). Defaults to the
#              highest existing v3.* tag plus one.
#   --dry-run  run every check and build the zip, but do not tag or push.
#
set -euo pipefail

UUID="system-monitor-next@paradoxxx.zero.gmail.com"
ZIPFILE="dist/${UUID}.zip"
RELEASE_BRANCH="master"

say() { printf '  [%-12s] %s\n' 'cut-release' "$1"; }
die() { printf '  [%-12s] ERROR: %s\n' 'cut-release' "$1" >&2; exit 1; }
usage() {
    printf 'Usage: %s [--dry-run] [VERSION]\n' "$0"
    printf '  VERSION    release number N for tag v3.N (default: latest tag + 1)\n'
    printf '  --dry-run  run checks and build, but do not tag or push\n'
}

dry_run=false
version=""
for arg in "$@"; do
    case "$arg" in
        --dry-run) dry_run=true ;;
        -h|--help) usage; exit 0 ;;
        [0-9]*)    version="$arg" ;;
        *)         die "unknown argument: $arg (try --help)" ;;
    esac
done

# Run from the repo root regardless of where we were invoked.
cd "$(dirname "$0")/.." || die "cannot cd to repo root"

# --- preflight -------------------------------------------------------------

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "$RELEASE_BRANCH" ] || die "not on $RELEASE_BRANCH (on $branch)"

if ! git diff --quiet || ! git diff --cached --quiet; then
    die "working tree is dirty; commit or stash first"
fi

say "Fetching origin/$RELEASE_BRANCH ..."
git fetch --quiet origin "$RELEASE_BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$RELEASE_BRANCH")" ] \
    || die "$RELEASE_BRANCH and origin/$RELEASE_BRANCH differ; pull or push so they match"

# --- version ---------------------------------------------------------------

if [ -z "$version" ]; then
    latest="$(git tag --list 'v3.*' --sort=-v:refname | head -n1)"
    [ -n "$latest" ] || die "no v3.* tags found; pass VERSION explicitly"
    version="$(( ${latest#v3.} + 1 ))"
fi
case "$version" in
    ''|*[!0-9]*) die "version must be a positive integer, got: $version" ;;
esac
tag="v3.${version}"

git rev-parse -q --verify "refs/tags/${tag}" >/dev/null 2>&1 \
    && die "tag ${tag} already exists"

say "Releasing ${tag} from ${branch} @ $(git rev-parse --short HEAD)"

# --- build + verify --------------------------------------------------------

make release "VERSION=${version}"

zipver="$(unzip -p "$ZIPFILE" metadata.json \
    | grep -o '"version":[[:space:]]*[0-9]\+' | grep -o '[0-9]\+')"
[ "$zipver" = "$version" ] \
    || die "zip metadata version ($zipver) does not match ${tag}"
say "Zip metadata version matches ${tag}"

if $dry_run; then
    say "DRY RUN: would create signed tag ${tag} and push it to origin"
    exit 0
fi

# --- tag + push ------------------------------------------------------------

# tag.gpgSign is enabled repo-wide, so this tag is signed. Signing needs a
# working GPG key and agent.
git tag -s "${tag}" -m "Release ${tag}"
say "Created signed tag ${tag}"

git push origin "${tag}"
say "Pushed ${tag} to origin"

# --- done ------------------------------------------------------------------

echo ''
say "Release ${tag} cut. One manual step remains:"
printf '    Upload %s (%s) at:\n' "$ZIPFILE" "$(du -h "$ZIPFILE" | cut -f1)"
printf '      https://extensions.gnome.org/upload/\n'
echo ''
