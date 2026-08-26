/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// system-monitor: Gnome shell extension displaying system informations in gnome shell status bar, such as memory usage, cpu usage, network rates…
// Copyright (C) 2011 Florian Mounier aka paradoxxxzero

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { sm_log } from './utils.js';

// Notifications go through Main.notify() rather than an owned
// MessageTray.Source: the Notification constructor changed shape over the
// shell versions metadata.json claims (45 through 50), and Main.notify() is
// the one spelling stable across all of them. Wrapping it means switching to a
// source of our own, should the attribution ever matter, stays a change to
// this file alone.
export const smNotifier = class SystemMonitor_smNotifier {
    constructor(extension) {
        this._extension = extension;
    }

    notify(title, body) {
        // Null between disable() and the next enable().
        if (!this._extension)
            return;
        if (!this._extension._Schema.get_boolean('alerts-enabled'))
            return;
        try {
            Main.notify(title, body);
        } catch (e) {
            sm_log(`Failed to raise notification: ${e}`, 'error');
        }
    }

    destroy() {
        this._extension = null;
    }
}
