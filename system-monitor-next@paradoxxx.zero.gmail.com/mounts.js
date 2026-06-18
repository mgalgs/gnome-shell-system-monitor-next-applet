/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";
import GTop from "gi://GTop";
import St from "gi://St";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { sm_log } from './utils.js';

// Visual distinction between adjacent mount rings/bars; cycled per index.
const MOUNT_SHADE_ALPHAS = [1.0, 0.7, 0.5];

// stale network shares will cause the shell to freeze, enable this with caution
export const ENABLE_NETWORK_DISK_USAGE = false;

export function interesting_mountpoint(mount) {
    if (mount.length < 3) {
        return false;
    }

    return ((mount[0].indexOf('/dev/') === 0 || mount[2].toLowerCase() === 'nfs') && mount[2].toLowerCase() !== 'udf');
}

// This is the algorithm used by the df utility. Returns an object with
// used and total fields, computed from a given statfs structure.
export function calc_usage(statfs) {
    // bfree represents the total amount of disk space remaining for the
    // superuser and internal FS operations, while bavail represents the space
    // remaining for an unprivileged user. The difference between bfree and
    // bavail represents reserved blocks that should not be part of the total
    // value, since users don't get to use those blocks. That is one way to
    // explain why total here is blocks - (bfree - bavail). Alternate
    // explanation: as bavail approaches 0, used and total should converge.
    const used = statfs.blocks - statfs.bfree;
    return {used, total: used + statfs.bavail};
}

// Class to deal with volumes insertion / ejection
export const smMountsMonitor = class SystemMonitor_smMountsMonitor {
    constructor() {
        this.files = [];
        this.num_mounts = -1;
        this.listeners = [];
        this.connected = false;

        this._volumeMonitor = Gio.VolumeMonitor.get();
        let sys_mounts = ['/home', '/tmp', '/boot', '/usr', '/usr/local'];
        this.base_mounts = ['/'];
        sys_mounts.forEach((sMount) => {
            if (this.is_sys_mount(sMount + '/')) {
                this.base_mounts.push(sMount);
            }
        });
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
        this.mounts = [];
        for (let base in this.base_mounts) {
            // log("[System monitor] " + this.base_mounts[base]);
            this.mounts.push(this.base_mounts[base]);
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
        // log("[System monitor] base: " + this.base_mounts);
        // log("[System monitor] mounts: " + this.mounts);
        for (let i in this.listeners) {
            this.listeners[i](this.mounts);
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
    is_sys_mount(mpath) {
        let file = Gio.file_new_for_path(mpath);
        try {
            let info = file.query_info(Gio.FILE_ATTRIBUTE_UNIX_IS_MOUNTPOINT,
                Gio.FileQueryInfoFlags.NONE, null);
            return info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_UNIX_IS_MOUNTPOINT);
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                return false;
            }
            throw e;
        }
    }
    is_ro_mount(mount) {
        // FIXME: running this function after "login after waking from suspend"
        // can make login hang. Actual issue seems to occur when a former net
        // mount got broken (e.g. due to a VPN connection terminated or
        // otherwise broken connection)
        try {
            let file = mount.get_default_location();
            let info = file.query_filesystem_info(Gio.FILE_ATTRIBUTE_FILESYSTEM_READONLY, null);
            return info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_FILESYSTEM_READONLY);
        } catch {
            return false;
        }
    }
    is_net_mount(mount) {
        try {
            let file = mount.get_default_location();
            let info = file.query_filesystem_info(Gio.FILE_ATTRIBUTE_FILESYSTEM_TYPE, null);
            let result = info.get_attribute_string(Gio.FILE_ATTRIBUTE_FILESYSTEM_TYPE);
            let net_fs = ['nfs', 'smbfs', 'cifs', 'ftp', 'sshfs', 'sftp', 'mtp', 'mtpfs'];
            return !file.is_native() || net_fs.indexOf(result) > -1;
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
        this.gtop = new GTop.glibtop_fsusage();

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
            GTop.glibtop_get_fsusage(this.gtop, this.mounts[mount]);
            const {used, total} = calc_usage(this.gtop);
            const perc_full = used / total;
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
            GTop.glibtop_get_fsusage(this.gtop, this.mounts[mount]);
            const alpha = MOUNT_SHADE_ALPHAS[mount % MOUNT_SHADE_ALPHAS.length];
            cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, alpha);
            const {used, total} = calc_usage(this.gtop);
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
