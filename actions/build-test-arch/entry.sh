#!/bin/bash

set -e

git clone https://github.com/mgalgs/gnome-shell-extension-system-monitor-next-git.git
cd gnome-shell-extension-system-monitor-next-git
makepkg --install --noconfirm
