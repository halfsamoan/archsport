// Keep long match lists reachable without letting the expanded notch leave the monitor.
export function calculateExpandedViewport({monitorHeight, panelHeight = 0, headerHeight,
    contentHeight, chromeHeight = 42, minRootHeight = 160, maxRootHeight = 520}) {
    const availableHeight = Math.max(minRootHeight,
        Math.min(maxRootHeight, monitorHeight - panelHeight - 24));
    const bodyLimit = Math.max(1, availableHeight - headerHeight - chromeHeight);
    const bodyHeight = Math.max(1, Math.min(contentHeight, bodyLimit));
    return {
        bodyHeight,
        rootHeight: Math.min(availableHeight, Math.ceil(headerHeight + bodyHeight + chromeHeight)),
        scrollable: contentHeight > bodyHeight,
    };
}

// Only a one-sided score increase with the same fixture identifies the scorer.
export function scoreDirection(previous, current, watchedTeams = []) {
    if (!previous || !current || previous.id !== current.id) return 'unknown';
    const oldScores = [previous.home_score, previous.away_score];
    const newScores = [current.home_score, current.away_score];
    if (![...oldScores, ...newScores].every(Number.isInteger)) return 'unknown';
    const deltas = newScores.map((score, index) => score - oldScores[index]);
    const side = deltas[0] > 0 && deltas[1] === 0 ? 'home' :
        deltas[1] > 0 && deltas[0] === 0 ? 'away' : null;
    if (!side) return 'unknown';
    const normalize = value => String(value ?? '').toLowerCase().replace(/\bfc\b/g, '').replace(/[^a-z0-9]/g, '');
    const watched = new Set(watchedTeams.map(normalize));
    const index = side === 'home' ? 0 : 1;
    return watched.has(normalize(current[side])) || watched.has(normalize(current.team_keys?.[index])) ?
        'watched' : 'opponent';
}
