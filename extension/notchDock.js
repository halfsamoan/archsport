import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {layoutNotches, canClaim} from './dockModel.js';

// One small registry on the common layoutManager, not a daemon or payload bus.
// Both independently installed extensions carry the same versioned adapter.
const KEY = '_archsportMatciNotchDockV1';

function getDock() {
    if (Main.layoutManager[KEY]) return Main.layoutManager[KEY];
    const dock = {
        participants: new Map(), active: null,
        reflow() {
            const groups = new Map();
            for (const participant of this.participants.values()) {
                const monitor = participant.monitor();
                if (!monitor || !participant.state.visible) {
                    participant.actor.hide();
                    continue;
                }
                const key = `${monitor.x}:${monitor.y}:${monitor.width}`;
                if (!groups.has(key)) groups.set(key, {monitor, entries: []});
                groups.get(key).entries.push({id: participant.id, ...participant.state,
                    order: participant.order, active: this.active?.id === participant.id});
            }
            for (const {monitor, entries} of groups.values()) {
                const panelHeight = monitor === Main.layoutManager.primaryMonitor ? Main.panel.height : 0;
                for (const placement of layoutNotches(entries, {...monitor, panelHeight})) {
                    const participant = this.participants.get(placement.id);
                    participant.actor.visible = !placement.fallback;
                    if (!placement.fallback) {
                        const duration = participant.animations.get_boolean('enable-animations') ? 320 : 0;
                        participant.actor.ease({x: placement.x, y: placement.y, duration,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                    }
                    participant.onPlacement?.(placement);
                }
            }
        },
    };
    Main.layoutManager[KEY] = dock;
    return dock;
}

export class DockParticipant {
    constructor({id, actor, monitor, order = 0, onYield, onPlacement}) {
        this.id = id;
        this.actor = actor;
        this.monitor = monitor;
        this.order = order;
        this.onYield = onYield;
        this.onPlacement = onPlacement;
        this.animations = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this.state = {width: 360, height: 46, visible: false, expanded: false};
        this.dock = getDock();
        this.dock.participants.set(id, this);
    }

    claim(priority = 100) {
        if (!canClaim(this.dock.active, this.id, priority)) return false;
        const previous = this.dock.active;
        this.dock.active = {id: this.id, priority};
        if (previous && previous.id !== this.id)
            this.dock.participants.get(previous.id)?.onYield?.();
        return true;
    }

    update(state) {
        const changed = Object.entries(state).some(([key, value]) => this.state[key] !== value);
        Object.assign(this.state, state);
        if ((state.expanded === false || state.visible === false) && this.dock.active?.id === this.id)
            this.dock.active = null;
        // Monitor and panel geometry can change even when this state is unchanged.
        const monitor = this.monitor();
        const geometry = monitor ? `${monitor.x}:${monitor.y}:${monitor.width}:${Main.panel.height}` : '';
        if (changed || geometry !== this.geometry) {
            this.geometry = geometry;
            this.dock.reflow();
        }
    }

    destroy() {
        const dock = this.dock;
        dock.participants.delete(this.id);
        if (dock.active?.id === this.id) dock.active = null;
        if (!dock.participants.size) delete Main.layoutManager[KEY];
        else dock.reflow();
        this.dock = this.actor = this.animations = null;
    }
}
