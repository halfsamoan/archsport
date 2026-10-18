// Pure geometry shared by the native dock, web preview, and Node checks.
export const DOCK_PROTOCOL = 2;

export function canClaim(active, id, priority) {
    return !active || active.id === id || priority >= active.priority;
}

export function layoutNotches(entries, monitor, gap = 8, margin = 12) {
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
