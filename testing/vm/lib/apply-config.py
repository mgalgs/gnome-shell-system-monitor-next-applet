#!/usr/bin/env python3
"""Apply a monitor config JSON file to gsettings. Run on the VM."""

import json
import subprocess
import sys

config_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/_sm_config.json'

with open(config_path) as f:
    data = json.load(f)

monitors = data.get('monitors', data) if isinstance(data, dict) else data
schema = 'org.gnome.shell.extensions.system-monitor-next-applet'

parts = [json.dumps(m, separators=(',', ':')) for m in monitors]
gvar = '[' + ', '.join("'" + p + "'" for p in parts) + ']'
subprocess.run(['gsettings', 'set', schema, 'monitors', gvar], check=True)

for k, v in data.get('settings', {}).items():
    if isinstance(v, bool):
        subprocess.run(['gsettings', 'set', schema, k, str(v).lower()], check=True)
    else:
        subprocess.run(['gsettings', 'set', schema, k, str(v)], check=True)
    print(f'Set {k} = {v}')
