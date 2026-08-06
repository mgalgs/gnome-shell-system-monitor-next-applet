/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { parse_bytearray } from './common.js';
import { sm_log } from './utils.js';

// Visual distinction between adjacent mount rings/bars; cycled per index.
const MOUNT_SHADE_ALPHAS = [1.0, 0.7, 0.5];

// Kernel filesystem types backed by a remote. gvfs backends never show up
// here: their GFiles are non-native, which is_net_mount() tests first.
const NET_FS_TYPES = ['nfs', 'nfs4', 'smbfs', 'cifs', 'smb3', 'ftp', 'sshfs',
    'sftp', 'mtp', 'mtpfs', 'fuse.sshfs', 'afs', 'ceph', '9p', 'davfs',
    'fuse.davfs', 'fuse.rclone', 'glusterfs', 'fuse.glusterfs', 'lustre'];

// Well-known system mountpoints, listed before removable media when a
// filesystem is actually mounted there.
const SYS_MOUNTS = ['/home', '/tmp', '/boot', '/usr', '/usr/local'];

// stale network shares will cause the shell to freeze, enable this with caution
export const ENABLE_NETWORK_DISK_USAGE = false;

export function interesting_mountpoint(mount) {
    if (mount.length < 3) {
        return false;
    }

    return ((mount[0].indexOf('/dev/') === 0 || mount[2].toLowerCase() === 'nfs') && mount[2].toLowerCase() !== 'udf');
}

// Class to deal with volumes insertion / ejection
export const smMountsMonitor = class SystemMonitor_smMountsMonitor {
    constructor() {
        this.files = [];
        this.num_mounts = -1;
        this.listeners = [];
        this.connected = false;
        this.mounts = [];
        this._mount_table = new Map();
        this._cancellable = null;
        this._usage = new Map();
        this._usage_inflight = new Set();
        this._usage_cancellable = null;
        this._usage_time = 0;

        this._volumeMonitor = Gio.VolumeMonitor.get();
        this.startListening();
    }
    refresh() {
        // try check that number of volumes has changed
        // try {
        //     let num_mounts = this.manager.getMounts().length;
        //     if (num_mounts == this.num_mounts)
        //         return;
        //     this.num_mounts = num_mounts;
        // } catch (e) {};

        // Can't get mountlist:
        // GTop.glibtop_get_mountlist
        // Error: No symbol 'glibtop_get_mountlist' in namespace 'GTop'
        // Getting it with mtab
        // let mount_lines = Shell.get_file_contents_utf8_sync('/etc/mtab').split("\n");
        // this.mounts = [];
        // for(let mount_line in mount_lines) {
        //     let mount = mount_lines[mount_line].split(" ");
        //     if(interesting_mountpoint(mount) && this.mounts.indexOf(mount[1]) < 0) {
        //         this.mounts.push(mount[1]);
        //     }
        // }
        // log("[System monitor] old mounts: " + this.mounts);
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        Gio.File.new_for_path('/proc/mounts').load_contents_async(this._cancellable, (file, result) => {
            let table;
            try {
                let [, contents] = file.load_contents_finish(result);
                table = this._parse_mount_table(parse_bytearray(contents));
            } catch {
                // Cancelled by stopListening(), or /proc/mounts unreadable.
                return;
            }
            this._mount_table = table;
            this._update_mounts();
        });
    }
    // Build mountpoint -> {fstype, ro} from /proc/mounts.
    _parse_mount_table(text) {
        let table = new Map();
        text.split('\n').forEach((line) => {
            let fields = line.split(' ');
            if (fields.length < 4) {
                return;
            }
            // /proc/mounts octal-escapes space, tab, newline and backslash.
            let mpath = fields[1].replace(/\\([0-7]{3})/g,
                (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
            // A later entry shadows an earlier one for the same mountpoint.
            table.set(mpath, {
                fstype: fields[2].toLowerCase(),
                // A network mount's source names the remote: //server/share
                // (SMB), server:/path (NFS-style) or scheme://... (davfs and
                // friends). Catches network filesystems whose fstype is not
                // in NET_FS_TYPES.
                remote: /^\/\/|^[^/]+:\//.test(fields[0]),
                ro: fields[3].split(',').indexOf('ro') > -1,
            });
        });
        return table;
    }
    // A mount's default location is not necessarily the mountpoint itself, so
    // walk up to the nearest entry, mirroring which filesystem a statfs() on
    // that path would have reported.
    _lookup_mount(file) {
        for (let f = file; f !== null; f = f.get_parent()) {
            let entry = this._mount_table.get(f.get_path());
            if (entry) {
                return entry;
            }
        }
        return null;
    }
    _update_mounts() {
        this.mounts = ['/'];
        for (const mpath of SYS_MOUNTS) {
            if (this._mount_table.has(mpath)) {
                this.mounts.push(mpath);
            }
        }
        let mount_lines = this._volumeMonitor.get_mounts();
        mount_lines.forEach((mount) => {
            if ((!this.is_net_mount(mount) || ENABLE_NETWORK_DISK_USAGE) &&
                 !this.is_ro_mount(mount)) {
                let mpath = mount.get_root().get_path() || mount.get_default_location().get_path();
                if (mpath) {
                    this.mounts.push(mpath);
                }
            }
        });
        // log("[System monitor] mounts: " + this.mounts);
        for (const mpath of this._usage.keys()) {
            if (this.mounts.indexOf(mpath) === -1) {
                this._usage.delete(mpath);
            }
        }
        for (let i in this.listeners) {
            this.listeners[i](this.mounts);
        }
        this._usage_time = 0;
        this.refresh_usage();
    }
    // Cached usage numbers for a mountpoint; zeros until the first
    // asynchronous refresh for that mount completes.
    get_usage(mpath) {
        return this._usage.get(mpath) ?? {used: 0, total: 0};
    }
    // Refresh the cached usage of every mount off the main thread. Repaints
    // request this on every frame, so issuing is rate-limited; a mount whose
    // filesystem hangs keeps its query in flight and is skipped on later
    // rounds, wedging one GIO worker thread instead of the shell.
    refresh_usage() {
        const USAGE_REFRESH_MIN_US = 2 * 1e6;
        let now = GLib.get_monotonic_time();
        if (now - this._usage_time < USAGE_REFRESH_MIN_US) {
            return;
        }
        this._usage_time = now;
        this._usage_cancellable ??= new Gio.Cancellable();
        for (const mpath of this.mounts) {
            if (this._usage_inflight.has(mpath)) {
                continue;
            }
            this._usage_inflight.add(mpath);
            Gio.File.new_for_path(mpath).query_filesystem_info_async(
                `${Gio.FILE_ATTRIBUTE_FILESYSTEM_USED},${Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE}`,
                GLib.PRIORITY_DEFAULT, this._usage_cancellable,
                (file, result) => {
                    this._usage_inflight.delete(mpath);
                    let info;
                    try {
                        info = file.query_filesystem_info_finish(result);
                    } catch {
                        // Cancelled, or the filesystem is unreadable; keep
                        // the last value we got.
                        return;
                    }
                    // df semantics: used includes the root-reserved blocks,
                    // free is what an unprivileged user can still write
                    // (f_bavail), so used/total converges to 1 as the user
                    // runs out of space.
                    let used = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_USED);
                    let total = used + info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE);
                    let prev = this._usage.get(mpath);
                    if (prev && prev.used === used && prev.total === total) {
                        return;
                    }
                    this._usage.set(mpath, {used, total});
                    for (let i in this.listeners) {
                        this.listeners[i](this.mounts);
                    }
                });
        }
    }
    add_listener(cb) {
        this.listeners.push(cb);
    }
    remove_listener(cb) {
        let idx = this.listeners.indexOf(cb);
        if (idx !== -1)
            this.listeners.splice(idx, 1);
    }
    get_mounts() {
        return this.mounts;
    }
    is_ro_mount(mount) {
        try {
            let file = mount.get_default_location();
            if (!file.is_native()) {
                // gvfs-backed; is_net_mount() already excludes these.
                return false;
            }
            let entry = this._lookup_mount(file);
            return entry ? entry.ro : false;
        } catch {
            return false;
        }
    }
    is_net_mount(mount) {
        try {
            let file = mount.get_default_location();
            // Non-native GFiles are gvfs-backed (MTP, SMB, SFTP, HTTP, ...).
            // is_native() is a local property, so it costs no I/O and must be
            // tested before anything that would touch the mount.
            if (!file.is_native()) {
                return true;
            }
            let entry = this._lookup_mount(file);
            return entry ? entry.remote || NET_FS_TYPES.indexOf(entry.fstype) > -1 : false;
        } catch {
            return false;
        }
    }
    startListening() {
        if (this.connected) {
            return;
        }
        try {
            this.manager = this._volumeMonitor;
            this.manager.connectObject(
                'mount-added', this.refresh.bind(this),
                'mount-removed', this.refresh.bind(this),
                this
            );
            // need to add the other signals here
            this.connected = true;
        } catch (e) {
            sm_log('Failed to register on placesManager notifications', 'error');
            sm_log('Got exception : ' + e, 'error');
        }
        this.refresh();
    }
    stopListening() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._usage_cancellable?.cancel();
        this._usage_cancellable = null;
        if (!this.connected) {
            return;
        }
        this.manager.disconnectObject(this);
        this.connected = false;
    }
    destroy() {
        this.stopListening();
    }
}

export const Graph = class SystemMonitor_Graph {
    constructor(extension, width, height) {
        this.extension = extension;
        this.menu_item = '';
        this.actor = new St.DrawingArea({style_class: this.extension._Style.get('sm-chart'), reactive: false});
        this.width = width;
        this.height = height;

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this.scale_factor = this._themeContext.scale_factor;
        this._interfaceSettings = new Gio.Settings({
            schema: 'org.gnome.desktop.interface'
        });
        this._themeContext.connectObject('notify::scale-factor', this.set_scale.bind(this), this);
        this._interfaceSettings.connectObject('changed', this.set_text_scaling.bind(this), this);
        this.text_scaling = this._interfaceSettings.get_double('text-scaling-factor');
        if (!this.text_scaling) {
            this.text_scaling = 1;
        }

        this.actor.set_width(this.width * this.scale_factor * this.text_scaling);
        this.actor.set_height(this.height * this.scale_factor * this.text_scaling);
        this.actor.connect('repaint', this._draw.bind(this));
    }
    create_menu_item() {
        this.menu_item = new PopupMenu.PopupBaseMenuItem({reactive: false});
        this.menu_item.actor.add_child(this.actor);
        // tray.menu.addMenuItem(this.menu_item);
    }
    show(visible) {
        this.menu_item.actor.visible = visible;
    }
    set_scale(themeContext) {
        this.scale_factor = themeContext.scale_factor;
        this.actor.set_width(this.width * this.scale_factor * this.text_scaling);
        this.actor.set_height(this.height * this.scale_factor * this.text_scaling);
    }
    set_text_scaling(interfaceSettings, key) {
        // FIXME: for some reason we only get this signal once, not on later
        // changes to the setting
        //log('[System monitor] got text scaling signal');
        this.text_scaling = interfaceSettings.get_double(key);
        this.actor.set_width(this.width * this.scale_factor * this.text_scaling);
        this.actor.set_height(this.height * this.scale_factor * this.text_scaling);
    }
    destroy() {
        this._themeContext.disconnectObject(this);
        this._interfaceSettings.disconnectObject(this);
    }
}

export const Bar = class SystemMonitor_Bar extends Graph {
    constructor(extension) {
        // Height doesn't matter, it gets set on every draw.
        super(extension, extension._Style.bar_width(), 100);
        this.mounts = extension._MountsMonitor.get_mounts();
        this._mountListener = this.update_mounts.bind(this);
        extension._MountsMonitor.add_listener(this._mountListener);
    }
    _draw() {
        if (!this.actor.visible) {
            return;
        }
        // Usage is collected asynchronously: this draw renders the cache and
        // the refresh notifies listeners, queueing a repaint, when a value
        // changes.
        this.extension._MountsMonitor.refresh_usage();
        let thickness = this.extension._Style.bar_thickness() * this.scale_factor * this.text_scaling;
        let fontsize = this.extension._Style.bar_fontsize() * this.scale_factor * this.text_scaling;
        this.actor.set_height(this.mounts.length * (3 * thickness));
        let [width, _height] = this.actor.get_surface_size();
        let cr = this.actor.get_context();

        let x0 = width / 8;
        let y0 = thickness / 2;
        cr.setLineWidth(thickness);
        cr.setFontSize(fontsize);
        const fg = this.actor.get_theme_node().get_foreground_color();
        for (let mount in this.mounts) {
            const {used, total} = this.extension._MountsMonitor.get_usage(this.mounts[mount]);
            const perc_full = total > 0 ? used / total : 0;
            const alpha = MOUNT_SHADE_ALPHAS[mount % MOUNT_SHADE_ALPHAS.length];
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, alpha);

            let text = this.mounts[mount];
            if (text.length > 10) {
                text = text.split('/').pop();
            }
            cr.moveTo(0, y0 + thickness / 3);
            cr.showText(text);
            cr.moveTo(width - x0, y0 + thickness / 3);
            cr.showText(Math.round(perc_full * 100).toString() + '%');
            y0 += (5 * thickness) / 4;

            cr.moveTo(0, y0);
            cr.relLineTo(perc_full * width, 0);
            cr.stroke();
            y0 += (7 * thickness) / 4;
        }
        cr.$dispose();
    }
    update_mounts(mounts) {
        this.mounts = mounts;
        this.actor.queue_repaint();
    }
    destroy() {
        this.extension._MountsMonitor?.remove_listener(this._mountListener);
        super.destroy();
    }
}

export const Pie = class SystemMonitor_Pie extends Graph {
    constructor(extension) {
        super(extension, extension._Style.pie_size(), extension._Style.pie_size());
        this.mounts = extension._MountsMonitor.get_mounts();
        this._mountListener = this.update_mounts.bind(this);
        extension._MountsMonitor.add_listener(this._mountListener);
    }

    _draw() {
        if (!this.actor.visible) {
            return;
        }
        // Usage is collected asynchronously; see Bar._draw().
        this.extension._MountsMonitor.refresh_usage();
        let [width, height] = this.actor.get_surface_size();
        let cr = this.actor.get_context();
        let xc = width / 2;
        let yc = height / 2;
        let pi = Math.PI;
        function arc(r, value, max, angle) {
            if (max === 0) {
                return angle;
            }
            let new_angle = angle + (value * 2 * pi / max);
            cr.arc(xc, yc, r, angle, new_angle);
            return new_angle;
        }

        // Set the ring thickness so that at least 7 rings can be displayed. If
        // there are more mounts, make the rings thinner. If the rings are too
        // thin to have a line height of 1.2 for the labels, shrink the labels.
        let rings = Math.max(this.mounts.length, 7);
        let ring_width = width / (2 * rings);
        let fontsize = this.extension._Style.pie_fontsize() * this.scale_factor * this.text_scaling;
        if (ring_width < 1.2 * fontsize) {
            fontsize = ring_width / 1.2;
        }
        let thickness = ring_width / 1.5;

        cr.setLineWidth(thickness);
        cr.setFontSize(fontsize);
        const fg = this.actor.get_theme_node().get_foreground_color();
        let r = (height - ring_width) / 2;
        for (let mount in this.mounts) {
            const alpha = MOUNT_SHADE_ALPHAS[mount % MOUNT_SHADE_ALPHAS.length];
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, alpha);
            const {used, total} = this.extension._MountsMonitor.get_usage(this.mounts[mount]);
            arc(r, used, total, -pi / 2);
            cr.stroke();
            r -= ring_width;
        }
        let y = (ring_width + fontsize) / 2;
        for (let mount in this.mounts) {
            const alpha = MOUNT_SHADE_ALPHAS[mount % MOUNT_SHADE_ALPHAS.length];
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, alpha);
            let text = this.mounts[mount];
            if (text.length > 10) {
                text = text.split('/').pop();
            }
            cr.moveTo(0, y);
            cr.showText(text);
            y += ring_width;
        }
        cr.$dispose();
    }

    update_mounts(mounts) {
        this.mounts = mounts;
        this.actor.queue_repaint();
    }
    destroy() {
        this.extension._MountsMonitor?.remove_listener(this._mountListener);
        super.destroy();
    }
}
