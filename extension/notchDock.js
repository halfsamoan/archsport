import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {DOCK_PROTOCOL, buttonNumber, layoutNotches, canClaim, isActorWithin, isPointWithinActor, pointInNotchShape, isPointWithinNotch, classifyOutsideSurface,
    shouldDismissOutside, dispatchOutsideDismiss} from './dockModel.js';
import {DESIGN} from './designTokens.js';

// One registry and one capture-phase listener for the two independently installed extensions.
const KEY = `_archsportMatciNotchDock_v${DOCK_PROTOCOL}`;
const OPEN_MS = DESIGN.motion.expand;
const CLOSE_MS = DESIGN.motion.collapse;
const POSITION_MS = DESIGN.motion.expand;

function layoutSourceHash() {
    let hash = 2166136261;
    const contract = [`protocol=${DOCK_PROTOCOL}`, `open=${OPEN_MS}`, `close=${CLOSE_MS}`, `position=${POSITION_MS}`,
        disconnectCapture, layoutNotches, canClaim, isActorWithin, isPointWithinActor,
        pointInNotchShape, isPointWithinNotch,
        classifyOutsideSurface, shouldDismissOutside, dispatchOutsideDismiss,
        eventCoordinates, buttonNumber, clearMorph, queueStage, hideActor, showActor,
        insideActiveSurface, getDock, DockParticipant]
        .map(fn => typeof fn === 'string' ? fn : fn.toString()).join('|');
    for (const char of `${contract}|capture-dismiss-v5|morph-v6|${DESIGN.motion.expandMode}|${DESIGN.motion.collapseMode}`) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function disconnectCapture(dock) {
    if (!dock.captureStage) return;
    try {
        if (dock.captureId) dock.captureStage.disconnect(dock.captureId);
        if (dock.stageDestroyId) dock.captureStage.disconnect(dock.stageDestroyId);
    } catch (_error) { /* stage is already being destroyed */ }
    dock.captureStage = null;
    dock.captureId = 0;
    dock.stageDestroyId = 0;
}

function eventCoordinates(event) {
    try {
        const [x, y] = event.get_coords();
        return {x, y};
    } catch (_error) {
        return {x: NaN, y: NaN};
    }
}

function clearMorph(participant) {
    for (const source of participant.morphSources) GLib.source_remove(source);
    participant.morphSources = [];
    participant.actor?.remove_all_transitions();
}

function queueStage(participant, delay, transitionId, callback) {
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
        participant.morphSources = participant.morphSources.filter(id => id !== source);
        if (!participant.disposed && participant.transitionId === transitionId) callback();
        return GLib.SOURCE_REMOVE;
    });
    participant.morphSources.push(source);
}

function hideActor(dock, participant, animate = true) {
    const actor = participant.actor;
    if (!actor || participant.disposed) return;
    if (participant.closing && animate) return;
    clearMorph(participant);
    participant.transitionId++;
    participant.closing = false;
    participant.targetGeometry = null;
    const transitionId = participant.transitionId;
    let duration = 0;
    try {
        if (animate && participant.animations.get_boolean('enable-animations')) duration = CLOSE_MS;
    } catch (_error) {
        duration = 0;
    }
    if (!actor.visible || !duration) {
        try {
            actor.visible = false;
            actor.opacity = 255;
        } catch (_error) { /* Shell owns final actor disposal */ }
        return;
    }
    participant.closing = true;
    try {
        const center = actor.x + actor.width / 2;
        actor.ease({x: center - DESIGN.geometry.neckWidth / 2,
            width: DESIGN.geometry.neckWidth, height: 8, duration,
            mode: Clutter.AnimationMode[DESIGN.motion.collapseMode],
            onComplete: () => {
                if (dock.shuttingDown || participant.disposed || participant.transitionId !== transitionId)
                    return;
                participant.closing = false;
                if (!participant.state.visible || participant.lastFallback) {
                    try { actor.visible = false; } catch (_error) { return; }
                }
                try { actor.opacity = 255; } catch (_error) {}
            }});
    } catch (_error) {
        participant.closing = false;
        try { actor.visible = false; } catch (_ignored) {}
    }
}

function showActor(dock, participant, placement) {
    const actor = participant.actor;
    if (!actor || participant.disposed || dock.shuttingDown) return;
    const wasHidden = !actor.visible;
    const target = `${placement.x}:${placement.y}:${placement.width}:${placement.height}`;
    if (!wasHidden && !participant.closing && participant.targetGeometry === target) return;
    clearMorph(participant);
    participant.transitionId++;
    participant.closing = false;
    participant.targetGeometry = target;
    const transitionId = participant.transitionId;
    try {
        let duration = 0;
        try {
            if (participant.animations.get_boolean('enable-animations')) duration = OPEN_MS;
        } catch (_error) {
            duration = 0;
        }
        const {width, height} = placement;
        const center = placement.x + width / 2;
        if (wasHidden) {
            actor.set_position(center - DESIGN.geometry.neckWidth / 2, placement.y);
            actor.set_size(DESIGN.geometry.neckWidth, 8);
            actor.visible = true;
        }
        actor.opacity = 255;
        if (!duration) {
            actor.set_position(placement.x, placement.y);
            actor.set_size(width, height);
            return;
        }
        if (!wasHidden && (height < actor.height || width < actor.width)) {
            actor.ease({x: placement.x, y: placement.y, width, height,
                duration: CLOSE_MS, mode: Clutter.AnimationMode[DESIGN.motion.collapseMode]});
            return;
        }
        if (!wasHidden && Math.abs(height - actor.height) < 2 && Math.abs(width - actor.width) < 2) {
            actor.ease({x: placement.x, y: placement.y, duration,
                mode: Clutter.AnimationMode[DESIGN.motion.expandMode]});
            return;
        }
        const middleWidth = Math.max(actor.width, Math.min(width, Math.round(width * 0.6)));
        const middleHeight = Math.min(height, Math.max(actor.height + 20, 42));
        if (wasHidden) actor.ease({x: center - (DESIGN.geometry.neckWidth + 8) / 2,
            width: DESIGN.geometry.neckWidth + 8, height: 12,
            duration: 45, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        queueStage(participant, wasHidden ? 25 : 0, transitionId, () =>
            actor.ease({x: center - middleWidth / 2, y: placement.y,
                width: middleWidth, height: middleHeight, duration: 95,
                mode: Clutter.AnimationMode[DESIGN.motion.expandMode]}));
        queueStage(participant, 70, transitionId, () =>
            actor.ease({x: placement.x, y: placement.y, width, height, duration: 140,
                mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC}));
    } catch (_error) {
        // A stale actor is left to Shell teardown; do not retry UI work during shutdown.
    }
}

function insideActiveSurface(participant, event) {
    const {x, y} = eventCoordinates(event);
    let source = null;
    try { source = event.get_source(); } catch (_error) {}
    // Preserve only the active notch's own opener; another app's panel button is outside.
    let trigger = null;
    try { trigger = participant.triggerActor?.(); } catch (_error) {}
    return classifyOutsideSurface({dockActor: participant.actor, ownerTrigger: trigger,
        eventSource: source, x, y});
}

function getDock() {
    if (Main.layoutManager[KEY]) return Main.layoutManager[KEY];
    const dock = {
        protocol: DOCK_PROTOCOL,
        owner: GLib.uuid_string_random(),
        sourceHash: layoutSourceHash(),
        participants: new Map(), active: null,
        shuttingDown: false,
        captureStage: global.stage,
        captureId: 0,
        shutdown() {
            if (this.shuttingDown) return;
            this.shuttingDown = true;
            disconnectCapture(this);
            for (const participant of [...this.participants.values()]) {
                try { participant.onShellShutdown?.(); } catch (_error) {}
            }
        },
        reflow() {
            if (this.shuttingDown) return;
            const groups = new Map();
            for (const participant of this.participants.values()) {
                let monitor = null;
                try { monitor = participant.monitor(); } catch (_error) {}
                if (!monitor) {
                    participant.lastFallback = false;
                    hideActor(this, participant, false);
                    continue;
                }
                if (!participant.state.visible) {
                    participant.lastFallback = false;
                    hideActor(this, participant, true);
                    continue;
                }
                const key = `${monitor.x}:${monitor.y}:${monitor.width}`;
                if (!groups.has(key)) groups.set(key, {monitor, entries: []});
                groups.get(key).entries.push({id: participant.id, ...participant.state,
                    order: participant.order, active: this.active?.id === participant.id});
            }
            for (const {monitor, entries} of groups.values()) {
                let panelHeight = 0;
                try {
                    if (monitor === Main.layoutManager.primaryMonitor) panelHeight = Main.panel.height;
                } catch (_error) {
                    if (this.shuttingDown) return;
                }
                for (const placement of layoutNotches(entries, {...monitor, panelHeight})) {
                    const participant = this.participants.get(placement.id);
                    if (!participant || participant.disposed) continue;
                    participant.lastFallback = placement.fallback;
                    if (placement.fallback) {
                        hideActor(this, participant, false);
                    } else {
                        showActor(this, participant, placement);
                    }
                    try { participant.onPlacement?.(placement); } catch (_error) {}
                }
            }
        },
    };
    dock.captureId = dock.captureStage.connect('captured-event', (_stage, event) => {
        if (dock.shuttingDown) return Clutter.EVENT_PROPAGATE;
        if (event.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_PROPAGATE;
        const owner = dock.active && dock.participants.get(dock.active.id);
        const inside = owner ? insideActiveSurface(owner, event) : null;
        if (owner) {
            try {
                dispatchOutsideDismiss({eventType: event.type(),
                    buttonPressType: Clutter.EventType.BUTTON_PRESS, active: Boolean(dock.active),
                    button: buttonNumber(event.get_button()), expanded: owner.state.visible && owner.state.expanded},
                () => owner.onOutside?.(), inside ?? {});
            } catch (error) {
                console.warn(`[notchDock] outside dismissal failed: ${error.message}`);
            }
        }
        // The clicked app, panel, or context menu must still receive the pointer event.
        return Clutter.EVENT_PROPAGATE;
    });
    dock.stageDestroyId = dock.captureStage.connect('destroy', () => dock.shutdown());
    Main.layoutManager[KEY] = dock;
    return dock;
}

export class DockParticipant {
    constructor({id, actor, monitor, order = 0, onYield, onOutside, onPlacement,
        onShellShutdown, triggerActor}) {
        this.id = id;
        this.actor = actor;
        this.monitor = monitor;
        this.order = order;
        this.onYield = onYield;
        this.onOutside = onOutside;
        this.onPlacement = onPlacement;
        this.onShellShutdown = onShellShutdown;
        this.triggerActor = triggerActor;
        this.animations = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this.targetGeometry = null;
        this.morphSources = [];
        this.lastFallback = false;
        this.transitionId = 0;
        this.closing = false;
        this.disposed = false;
        this.state = {width: 360, height: 46, visible: false, expanded: false};
        this.dock = getDock();
        if (this.dock.sourceHash !== layoutSourceHash() && !this.dock.sourceMismatchLogged) {
            this.dock.sourceMismatchLogged = true;
            console.warn(`[notchDock] shared layout source differs; owner=${this.dock.owner}, protocol=${this.dock.protocol}`);
        }
        this.dock.participants.set(id, this);
    }

    claim(priority = 100) {
        if (this.disposed || this.dock.shuttingDown || !canClaim(this.dock.active, this.id, priority)) return false;
        const previous = this.dock.active;
        this.dock.active = {id: this.id, priority};
        if (previous && previous.id !== this.id)
            this.dock.participants.get(previous.id)?.onYield?.();
        return true;
    }

    update(state) {
        if (this.disposed || this.dock.shuttingDown) return;
        const changed = Object.entries(state).some(([key, value]) => this.state[key] !== value);
        Object.assign(this.state, state);
        if ((state.expanded === false || state.visible === false) && this.dock.active?.id === this.id)
            this.dock.active = null;
        const monitor = this.monitor();
        let panelHeight = 0;
        try {
            if (monitor === Main.layoutManager.primaryMonitor) panelHeight = Main.panel.height;
        } catch (_error) {
            if (this.dock.shuttingDown) return;
        }
        const geometry = monitor ? `${monitor.x}:${monitor.y}:${monitor.width}:${panelHeight}` : '';
        const expectedVisible = Boolean(this.state.visible && !this.lastFallback);
        let actorVisible = false;
        try { actorVisible = this.actor.visible; } catch (_error) {}
        if (changed || geometry !== this.geometry || actorVisible !== expectedVisible) {
            this.geometry = geometry;
            this.dock.reflow();
        }
    }

    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        clearMorph(this);
        const dock = this.dock;
        if (!dock) return;
        dock.participants.delete(this.id);
        if (dock.active?.id === this.id) dock.active = null;
        if (!dock.shuttingDown) {
            hideActor(dock, this, false);
            if (!dock.participants.size) {
                disconnectCapture(dock);
                try {
                    if (Main.layoutManager[KEY] === dock) delete Main.layoutManager[KEY];
                } catch (_error) {}
            } else {
                dock.reflow();
            }
        } else if (!dock.participants.size) {
            try {
                if (Main.layoutManager[KEY] === dock) delete Main.layoutManager[KEY];
            } catch (_error) {}
        }
        this.dock = this.actor = this.animations = this.triggerActor = null;
    }
}
