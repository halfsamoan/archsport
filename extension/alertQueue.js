function alertIdentity(alert) {
    const identity = {...alert};
    delete identity.queued_at;
    return JSON.stringify(identity);
}

const ALERT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function enqueuePendingAlert(queue, alert, now = Date.now()) {
    if (!alert || typeof alert !== 'object') return;
    const queued = Number.isFinite(alert.queued_at) ? alert : {...alert, queued_at: now};
    if (!queue.some(item => alertIdentity(item) === alertIdentity(queued)))
        queue.push(queued);
}

export function expirePendingAlerts(queue, now = Date.now()) {
    const originalLength = queue.length;
    for (let index = queue.length - 1; index >= 0; index--) {
        const queuedAt = queue[index]?.queued_at;
        if (!Number.isFinite(queuedAt) || queuedAt > now || now - queuedAt > ALERT_MAX_AGE_MS)
            queue.splice(index, 1);
    }
    return originalLength - queue.length;
}

export function takePendingAlert(queue, claim, now = Date.now()) {
    expirePendingAlerts(queue, now);
    if (!queue.length || !claim()) return null;
    return queue.shift();
}

export function restorePendingAlerts(record, payload, now = Date.now()) {
    if (!record || !Array.isArray(record.alerts) || !Number.isFinite(record.saved_at))
        return [];

    const context = payload?.context ?? {};
    const fixtures = [payload?.match, context.upcoming, ...(context.live_matches ?? []),
        ...(context.upcoming_matches ?? []), ...(context.recent ?? [])].filter(Boolean);
    return record.alerts.filter(alert => {
        if (!alert || typeof alert !== 'object' || typeof alert.match_id !== 'string' ||
            typeof alert.kickoff_utc !== 'string') return false;
        const queuedAt = Number.isFinite(alert.queued_at) ? alert.queued_at : record.saved_at;
        return Number.isFinite(queuedAt) && queuedAt <= now && now - queuedAt <= ALERT_MAX_AGE_MS &&
            fixtures.some(fixture => String(fixture.id) === alert.match_id &&
                fixture.kickoff_utc === alert.kickoff_utc);
    }).map(alert => ({...alert,
        queued_at: Number.isFinite(alert.queued_at) ? alert.queued_at : record.saved_at}));
}
