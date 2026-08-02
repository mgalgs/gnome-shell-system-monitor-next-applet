#!/bin/sh
##################################################################################
#    This file is part of System Monitor Gnome extension.
#    System Monitor Gnome extension is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#    System Monitor Gnome extension is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#    You should have received a copy of the GNU General Public License
#    along with System Monitor.  If not, see <http://www.gnu.org/licenses/>.
#    Copyright 2017 Fran Glais, David King, indigohedgehog@github.
##################################################################################

##################################################################################
#
#   GPU memory and utilisation, for every GPU this machine can report on.
#
#   Adding support for another driver means adding a branch below that prints
#   the same four fields, one line per GPU, space separated:
#
#       <index> <total MiB> <used MiB> <busy %>
#
#   For example, a machine with two cards:
#
#       0 24564 3120 47
#       1 24564 88 0
#
#   Rules the extension relies on:
#
#     * Memory is MiB. Both figures, always.
#     * Indices start at 0 and are contiguous. They are what the preferences
#       GPU picker offers, so a gap means an entry the panel cannot fill.
#     * A driver that exposes no utilisation counter prints 0 for busy. That
#       is expected, not a hole in your branch.
#     * Print nothing at all if this machine has no GPU you can read. The
#       extension says so rather than showing a zero it did not measure.
#
#   Takes no arguments: every GPU is reported in one run, so the extension
#   spawns this once per refresh however many GPU widgets are on the panel.
#
##################################################################################

checkcommand()
{
	command -v "$1" > /dev/null 2>&1
}

# nvidia-smi reports every GPU in one call, so its own exit status is the
# probe -- no separate --list-gpus run.
if out=$(nvidia-smi --query-gpu=index,memory.total,memory.used,utilization.gpu \
		--format=csv,noheader,nounits 2>/dev/null) && [ -n "$out" ]; then
	echo "$out" | tr -d ' ' | tr ',' ' '
	exit 0
fi

# DRM card numbers do not always start at 0 (the GPU can be card1 with no
# card0, e.g. alongside an integrated GPU), and cards without vram counters
# are not reportable at all, so the index is the position among the cards we
# can actually read.
amd_found=0
i=0
for d in /sys/class/drm/card[0-9] /sys/class/drm/card[0-9][0-9]; do
	[ -e "$d/device/mem_info_vram_total" ] || continue
	total=$(cat "$d/device/mem_info_vram_total" 2>/dev/null) || continue
	used=$(cat "$d/device/mem_info_vram_used" 2>/dev/null) || used=0
	busy=$(cat "$d/device/gpu_busy_percent" 2>/dev/null) || busy=0
	echo "$i $((total / 1024 / 1024)) $((used / 1024 / 1024)) $busy"
	i=$((i + 1))
	amd_found=1
done
[ "$amd_found" -eq 1 ] && exit 0

if checkcommand glxinfo; then
	TOTALVRAM=$(glxinfo | grep -A2 -i GL_NVX_gpu_memory_info | grep -E -i 'dedicated')
	TOTALVRAM=${TOTALVRAM##*:[[:blank:]]}
	TOTALVRAM=${TOTALVRAM%%[[:blank:]]MB*}
	AVAILVRAM=$(glxinfo | grep -A4 -i GL_NVX_gpu_memory_info | grep -E -i 'available dedicated')
	AVAILVRAM=${AVAILVRAM##*:[[:blank:]]}
	AVAILVRAM=${AVAILVRAM%%[[:blank:]]MB*}
	if [ -n "$TOTALVRAM" ] && [ -n "$AVAILVRAM" ]; then
		# glxinfo reports no utilisation counter.
		echo "0 $TOTALVRAM $((TOTALVRAM - AVAILVRAM)) 0"
	fi
fi
