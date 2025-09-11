#!/bin/bash

# Required environment variables:

#   - GSSMN_SOURCES :: Directory containing the
#                      gnome-shell-system-monitor-next sources
#   - GSSMN_SHA1    :: The sha1 to checkout and build

set -e

[[ -z "$GSSMN_SOURCES" ]] && {
    echo "GSSMN_SOURCES env var is required"
    exit 1
}

[[ -z "$GSSMN_SHA1" ]] && {
    echo "GSSMN_SHA1 env var is required"
    exit 1
}

GSSMN_SOURCES=$(realpath "$GSSMN_SOURCES")
GSSMN_SHA1_SHORT=$(c=${GSSMN_SHA1}; echo ${c:0:7})

# Ensure HOME is set to a directory the builder user owns.
export HOME=/home/builder
cd /home/builder

# Clone the RPM spec file
# git clone https://src.fedoraproject.org/rpms/gnome-shell-extension-system-monitor-applet.git

# TODO: Switch back to upstream (above) once the RPM source build changes
# are integrated there
git clone https://github.com/mgalgs/gnome-shell-extension-system-monitor-applet-RPM.git gnome-shell-extension-system-monitor-applet
cd gnome-shell-extension-system-monitor-applet/

RPMVERSION=$(grep -E '^Version:.*[0-9]+' \
                  ./gnome-shell-extension-system-monitor-applet.spec \
                 | awk '{print $2}')
SOURCE_TARBALL_NAME=gnome-shell-extension-system-monitor-applet-${RPMVERSION}-${GSSMN_SHA1_SHORT}.tar.gz
SOURCE_TARBALL_PATH=~/rpmbuild/SOURCES/$SOURCE_TARBALL_NAME

# Generate a new source tarball for the RPM
mkdir -pv ~/rpmbuild/SOURCES/

# Create a source archive directly from the mounted repository without modifying it
git -C "$GSSMN_SOURCES" archive \
    --format=tar.gz \
    --prefix=gnome-shell-system-monitor-next-applet-${GSSMN_SHA1}/ \
    "$GSSMN_SHA1" > "$SOURCE_TARBALL_PATH"
SOURCE_SHA512=$(sha512sum "$SOURCE_TARBALL_PATH" | awk '{print $1}')

# Patch the spec and source files to use our freshly archived source tarball
cd ~/gnome-shell-extension-system-monitor-applet/
sed -i \
    "s/%global gitcommit [0-9a-f]\{40\}/%global gitcommit ${GSSMN_SHA1}/" \
    gnome-shell-extension-system-monitor-applet.spec

# Simulate downstream RPM maintainer snapshot steps: set gitsnapinfo
# (.YYYYMMDDgit%{gitshortcommit}), bump Release, and rewrite the top %changelog
# header (preserving maintainer and Epoch)
DATE_REAL=$(LANG=C date "+%a %b %d %Y")
DATE_ABBR=$(LANG=C date "+%Y%m%d")
RPMRELEASE=$(grep -woE '^Release: *[0-9]+' ./gnome-shell-extension-system-monitor-applet.spec | awk '{print $2}')
RPMRELEASE=$((${RPMRELEASE}+1))

sed -i \
    -e "s/^%global gitsnapinfo.*/%global gitsnapinfo .${DATE_ABBR}git%{gitshortcommit}/" \
    -e "s/^\(Release:\s*\)[0-9]\+/\1${RPMRELEASE}/" \
    -e "/^%changelog/{n;s/\(^\* .*[0-9]\{4\} \)\(.* [0-9]:\)\(.*\)/\* ${DATE_REAL} \2${RPMVERSION}-${RPMRELEASE}\.${DATE_ABBR}git${GSSMN_SHA1_SHORT}/}" \
    ./gnome-shell-extension-system-monitor-applet.spec

echo "SHA512 ($SOURCE_TARBALL_NAME) = ${SOURCE_SHA512}" > sources

# Build and install!
rpmbuild -bb ./gnome-shell-extension-system-monitor-applet.spec
# Install the freshly built RPM without enabling network repos; fail if hard deps are missing
sudo dnf -y --disablerepo='*' --setopt=install_weak_deps=False install ~/rpmbuild/RPMS/noarch/*.rpm

if [[ $? -eq 0 ]]; then
    echo "RPM build test successful"
else
    echo "RPM build test failed :("
fi
