// Keep long match lists reachable without letting the expanded notch leave the monitor.
export function calculateExpandedViewport({monitorHeight, panelHeight = 0, headerHeight,
    contentHeight, chromeHeight = 32, minRootHeight = 140, maxRootHeight = 480}) {
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

const EVENT_LABELS = {
    'Normal Goal': '골', 'Own Goal': '자책골', 'Penalty': 'PK 골', 'Missed Penalty': 'PK 실축',
    'Yellow Card': '경고', 'Red Card': '퇴장', 'Second Yellow card': '경고 누적 퇴장',
    'Goal cancelled': 'VAR 골 취소', 'Goal Disallowed': 'VAR 골 취소', 'Penalty confirmed': 'VAR PK 확정',
    'Penalty cancelled': 'VAR PK 취소', 'Card upgrade': 'VAR 카드 변경',
};

// '골 · 61′ · R. Lewandowski': what happened first, so a card never reads like a goal.
export function eventSummary(event) {
    if (!event) return '';
    const elapsed = Number.isInteger(event.elapsed) ? `${event.elapsed}${Number.isInteger(event.extra) &&
        event.extra > 0 ? `+${event.extra}` : ''}′` : '';
    const player = String(event.player ?? '').trim();
    const rawDetail = String(event.detail ?? '').trim();
    const kind = String(event.kind ?? '').toLowerCase();
    const label = EVENT_LABELS[rawDetail] ?? (kind === 'goal' ? '골' : kind === 'subst' ? '교체' :
        kind === 'var' ? `VAR${rawDetail ? ` ${rawDetail}` : ''}` : kind === 'card' ? '카드' : rawDetail);
    return [label, elapsed, player].filter(Boolean).join(' · ') || '경기 상황';
}

export function alertAnnouncement(alert, match, spoiler = false) {
    const title = String(alert?.title ?? (alert?.kind === 'score' ? '스코어 변경' : '킥오프'));
    if (spoiler) return `${title} 알림`;
    if (alert?.kind === 'kickoff')
        return `${title}. ${alert.club ?? '경기'} 대 ${alert.opponent ?? '상대'}.`;
    const score = match ? `${match.home ?? '홈'} ${match.home_score ?? '미확인'} 대 ` +
        `${match.away_score ?? '미확인'} ${match.away ?? '원정'}` : '';
    const goal = match?.events?.filter(event => event.kind === 'Goal' && event.detail !== 'Missed Penalty').at(-1);
    return [title, score, eventSummary(goal)].filter(Boolean).join('. ');
}
