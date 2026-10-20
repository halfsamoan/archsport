// Pure geometry shared by the native dock, web preview, and Node checks.
import {DESIGN} from './designTokens.js';
export const DOCK_PROTOCOL = 6;

// One slab continuing the top panel: concave ears at the top corners, vertical
// sides, rounded bottom. Ears grow with height; low slabs get a smaller radius.
export function notchGeometry(height, width = Infinity) {
    const {earMin, earMax} = DESIGN.geometry;
    const ear = Math.max(0, Math.min(earMax, Math.max(earMin, Math.round(height * 0.1)), Math.floor(width / 4)));
    const radius = Math.max(0, Math.min(DESIGN.radius.surface, Math.round(height * 0.45), height - ear));
    return {ear, radius, sliver: height <= ear + 4 || radius < 1};
}

export function buttonNumber(result) {
    if (Array.isArray(result)) return result[1] ?? 0;
    return result ?? 0;
}

export function canClaim(active, id, priority) {
    return !active || active.id === id || priority >= active.priority;
}

export function isActorWithin(source, ancestor) {
    if (!source || !ancestor) return false;
    try {
        for (let current = source; current; current = current.get_parent?.()) {
            if (current === ancestor) return true;
        }
    } catch (_error) {
        // A Shell actor can disappear while a captured event is being dispatched.
    }
    return false;
}

export function isPointWithinActor(actor, x, y) {
    if (!actor || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    try {
        const [left, top] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return x >= left && y >= top && x <= left + width && y <= top + height;
    } catch (_error) {
        return false;
    }
}

// The slab between the ears accepts the pointer; the ears and the space outside
// the rounded bottom corners stay with whatever is underneath.
export function pointInNotchShape(x, y, width, height) {
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ||
        x < 0 || y < 0 || x > width || y > height) return false;
    const {ear, radius, sliver} = notchGeometry(height, width);
    if (sliver) return true;
    if (x < ear || x > width - ear) return false;
    if (y <= height - radius) return true;
    const cx = Math.min(Math.max(x, ear + radius), width - ear - radius);
    return (x - cx) ** 2 + (y - (height - radius)) ** 2 <= radius ** 2;
}

export function isPointWithinNotch(actor, x, y) {
    if (!actor || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    try {
        const [left, top] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return pointInNotchShape(x - left, y - top, width, height);
    } catch (_error) {
        return false;
    }
}

export function classifyOutsideSurface({dockActor, ownerTrigger, eventSource, x, y}) {
    return {
        insideDock: Number.isFinite(x) && Number.isFinite(y) ? isPointWithinNotch(dockActor, x, y) :
            isActorWithin(eventSource, dockActor),
        insideOwnerTrigger: isActorWithin(eventSource, ownerTrigger) || isPointWithinActor(ownerTrigger, x, y),
    };
}

export function shouldDismissOutside({eventType, buttonPressType, active, expanded,
    button, insideDock = false, insideOwnerTrigger = false}) {
    return eventType === buttonPressType && (button === 1 || button === 3) &&
        Boolean(active && expanded) &&
        !insideDock && !insideOwnerTrigger;
}

export function dispatchOutsideDismiss(input, onDismiss, surface = {}) {
    if (!shouldDismissOutside({...input, ...surface})) return false;
    onDismiss?.();
    return true;
}

export function layoutNotches(entries, monitor, gap = 6, margin = 12) {
    const available = Math.max(1, monitor.width - margin * 2);
    const items = entries.map(entry => ({...entry,
        width: Math.min(Math.max(1, entry.width), available), fallback: false,
    })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    if (items.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, items.length - 1) > available) {
        const winner = items.find(item => item.active) ?? items[0];
        for (const item of items) item.fallback = item !== winner;
    }
    const visible = items.filter(item => !item.fallback);
    const width = visible.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, visible.length - 1);
    let x = Math.round(monitor.x + (monitor.width - width) / 2);
    return items.map(item => {
        const position = {...item, x, y: monitor.y + (monitor.panelHeight ?? 0)};
        if (!item.fallback) x += item.width + gap;
        return position;
    });
}
