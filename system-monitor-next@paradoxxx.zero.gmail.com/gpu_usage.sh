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

##################################
#                                #
#   Check for GPU memory usage   #
#                                #
##################################

checkcommand()
{
  command -v "$1" > /dev/null 2>&1
}

# This will print three lines. The first one is the total vRAM available,
# the second one is the used vRAM and the third one is the GPU usage in %.
if nvidia-smi --list-gpus > /dev/null 2>&1  ; then
  nvidia-smi -i 0 --query-gpu=memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits | while IFS=', ' read -r a b c; do echo "$a"; echo "$b"; echo "$c"; done

elif lsmod | grep -q amdgpu; then
  # Dynamic detection of AMD GPU path
  gpu_path=""
  for c in /sys/class/drm/card*; do
    if [ -f "$c/device/mem_info_vram_total" ]; then
      gpu_path="$c/device"
      break
    fi
  done

  if [ -n "$gpu_path" ]; then
    total=$(cat "$gpu_path/mem_info_vram_total")
    echo $(($total / 1024 / 1024))

    used=$(cat "$gpu_path/mem_info_vram_used")
    echo $(($used / 1024 / 1024))

    if [ -f "$gpu_path/gpu_busy_percent" ]; then
      cat "$gpu_path/gpu_busy_percent"
    else
      echo 0
    fi
  fi

elif checkcommand glxinfo; then
  # ... (mantener lógica de glxinfo original) ...
  TOTALVRAM=$(glxinfo | grep -A2 -i GL_NVX_gpu_memory_info | grep -E -i 'dedicated')
  TOTALVRAM=${TOTALVRAM##*:[[:blank:]]}
  TOTALVRAM=${TOTALVRAM%%[[:blank:]]MB*}
  AVAILVRAM=$(glxinfo | grep -A4 -i GL_NVX_gpu_memory_info | grep -E -i 'available dedicated')
  AVAILVRAM=${AVAILVRAM##*:[[:blank:]]}
  AVAILVRAM=${AVAILVRAM%%[[:blank:]]MB*}
  # Usar $(( )) para aritmética estándar en lugar de 'let' para mayor compatibilidad
  echo "$TOTALVRAM"
  echo $((TOTALVRAM - AVAILVRAM))
fi
