/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

import St from "gi://St";

const Icon = class SystemMonitor_Icon {
    constructor(extension) {
        this.extension = extension;
        this.actor = new St.Icon({
            icon_name: 'org.gnome.SystemMonitor-symbolic',
            style_class: 'system-status-icon'
        });
        this.actor.visible = this.extension._Schema.get_boolean('icon-display');
        this._sigId = this.extension._Schema.connect(
            'changed::icon-display',
            () => {
                this.actor.visible = this.extension._Schema.get_boolean('icon-display');
            }
        );
    }
    destroy() {
        if (this._sigId) {
            this.extension._Schema.disconnect(this._sigId);
            this._sigId = null;
        }
    }
}

export { Icon };
