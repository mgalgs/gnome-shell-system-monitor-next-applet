#!/bin/bash

set -e

# Ensure HOME is set to a directory the builder user owns This prevents
# permission issues when the build tries to write to $HOME/.local
export HOME=/home/builder

# Create a directory where builder has permissions
mkdir -p /home/builder/build
cd /home/builder/build

# Clone the AUR build files
git clone https://github.com/mgalgs/gnome-shell-extension-system-monitor-next-git.git
cd gnome-shell-extension-system-monitor-next-git
makepkg --install --noconfirm

if [[ $? -eq 0 ]]; then
    echo "Arch build test successful"
else
    echo "Arch build test failed :("
fi
