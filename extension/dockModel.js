// Pure geometry shared by the native dock, web preview, and Node checks.
import {DESIGN} from './designTokens.js';
export const DOCK_PROTOCOL = 5;

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

// Three simple regions follow the visual neck/shoulder/body closely enough for
// pointer routing without treating the transparent top corners as the dock.
export function pointInNotchShape(x, y, width, height) {
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ||
        x < 0 || y < 0 || x > width || y > height) return false;
    const neck = Math.min(DESIGN.geometry.neckWidth, Math.max(1, width - 24));
    const neckHeight = DESIGN.geometry.neckHeight;
    const shoulder = Math.min(height <= 60 ? DESIGN.geometry.compactShoulder :
        neckHeight + DESIGN.geometry.shoulderDepth, Math.max(neckHeight, height - 12));
    const half = neck / 2 + (width - neck) / 2 *
        Math.max(0, Math.min(1, (y - neckHeight) / Math.max(1, shoulder - neckHeight)));
    if (y < shoulder) return y < neckHeight ? Math.abs(x - width / 2) <= neck / 2 :
        Math.abs(x - width / 2) <= half;
    const radius = Math.min(DESIGN.radius.surface, Math.max(1, height - shoulder));
    if (y <= height - radius || (x >= radius && x <= width - radius)) return true;
    const cx = x < radius ? radius : width - radius;
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
