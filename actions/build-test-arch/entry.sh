#!/bin/bash

set -e

# Clone the AUR build files
git clone https://github.com/mgalgs/gnome-shell-extension-system-monitor-next-git.git
cd gnome-shell-extension-system-monitor-next-git
makepkg --install --noconfirm
