import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {DOCK_PROTOCOL, layoutNotches, canClaim} from './dockModel.js';

// One small registry on the common layoutManager, not a daemon or payload bus.
// Both independently installed extensions carry the same versioned adapter.
const KEY = `_archsportMatciNotchDock_v${DOCK_PROTOCOL}`;

function layoutSourceHash() {
    let hash = 2166136261;
    for (const char of layoutNotches.toString()) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function getDock() {
    if (Main.layoutManager[KEY]) return Main.layoutManager[KEY];
    const dock = {
        protocol: DOCK_PROTOCOL,
        owner: GLib.uuid_string_random(),
        sourceHash: layoutSourceHash(),
        participants: new Map(), active: null,
        reflow() {
            const groups = new Map();
            for (const participant of this.participants.values()) {
                const monitor = participant.monitor();
                if (!monitor || !participant.state.visible) {
                    participant.lastFallback = false;
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
                    participant.lastFallback = placement.fallback;
                    participant.actor.visible = participant.state.visible && !placement.fallback;
                    if (!placement.fallback) {
                        const target = `${placement.x}:${placement.y}`;
                        if (participant.targetPosition !== target) {
                            participant.targetPosition = target;
                            const duration = participant.animations.get_boolean('enable-animations') ? 320 : 0;
                            participant.actor.ease({x: placement.x, y: placement.y, duration,
                                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                        }
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
        this.targetPosition = null;
        this.lastFallback = false;
        this.state = {width: 360, height: 46, visible: false, expanded: false};
        this.dock = getDock();
        if (this.dock.sourceHash !== layoutSourceHash() && !this.dock.sourceMismatchLogged) {
            this.dock.sourceMismatchLogged = true;
            console.warn(`[notchDock] shared layout source differs; owner=${this.dock.owner}, protocol=${this.dock.protocol}`);
        }
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
        const expectedVisible = Boolean(this.state.visible && !this.lastFallback);
        if (changed || geometry !== this.geometry || this.actor.visible !== expectedVisible) {
            this.geometry = geometry;
            this.dock.reflow();
        }
    }

    destroy() {
        const dock = this.dock;
        dock.participants.delete(this.id);
        if (dock.active?.id === this.id) dock.active = null;
        if (!dock.participants.size)
            delete Main.layoutManager[KEY];
        else dock.reflow();
        this.dock = this.actor = this.animations = null;
    }
}
