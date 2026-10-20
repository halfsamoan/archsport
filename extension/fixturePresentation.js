const DISPLAY_NAMES = new Map([
    ['paris saint germain fc', 'PSG'], ['paris saint germain', 'PSG'],
    ['fc barcelona', 'Barcelona'], ['barcelona', 'Barcelona'],
    ['como 1907', 'Como'], ['como 1907 fc', 'Como'], ['como', 'Como'],
    ['manchester united fc', 'Man United'], ['manchester united', 'Man United'],
    ['ss lazio', 'Lazio'], ['lazio', 'Lazio'],
    ['parma calcio 1913', 'Parma'], ['parma', 'Parma'],
    ['real betis balompie', 'Betis'], ['real betis', 'Betis'],
    ['feyenoord rotterdam', 'Feyenoord'], ['feyenoord', 'Feyenoord'],
]);
const WATCHED_IDS = new Map([[529, 'barcelona'], [487, 'lazio'], [895, 'como']]);
const WATCHED_NAMES = new Map([
    ['fc barcelona', 'barcelona'], ['barcelona', 'barcelona'],
    ['ss lazio', 'lazio'], ['lazio', 'lazio'],
    ['como 1907', 'como'], ['como 1907 fc', 'como'], ['como', 'como'],
]);

function normalized(value) {
    return String(value ?? '').toLowerCase().normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function displayTeam(fixture, side) {
    const id = Number(fixture?.[`${side}_id`]);
    if (WATCHED_IDS.has(id))
        return {barcelona: 'Barcelona', lazio: 'Lazio', como: 'Como'}[WATCHED_IDS.get(id)];
    const original = String(fixture?.[side] ?? '—');
    return DISPLAY_NAMES.get(normalized(original)) ?? original;
}

function watchedKey(fixture, side) {
    const id = Number(fixture?.[`${side}_id`]);
    if (WATCHED_IDS.has(id)) return WATCHED_IDS.get(id);
    const index = side === 'home' ? 0 : 1;
    return WATCHED_NAMES.get(normalized(fixture?.team_keys?.[index])) ??
        WATCHED_NAMES.get(normalized(fixture?.[side]));
}

export function fixturePresentation(fixture, watchedTeams, {result = false, spoiler = false} = {}) {
    const watched = new Set(watchedTeams.map(value => WATCHED_NAMES.get(normalized(value)) ?? normalized(value)));
    const sides = ['home', 'away'].filter(side => watched.has(watchedKey(fixture, side)));
    const oneSide = sides.length === 1 ? sides[0] : null;
    const opponent = oneSide === 'home' ? 'away' : 'home';
    const primary = oneSide ? displayTeam(fixture, opponent) :
        `${displayTeam(fixture, 'home')} — ${displayTeam(fixture, 'away')}`;
    const direction = oneSide ? oneSide === 'home' ? '홈' : '원정' : '';
    const score = spoiler ? '● : ●' : `${fixture?.home_score ?? '–'} : ${fixture?.away_score ?? '–'}`;
    const date = fixture?.kickoff_utc ? new Date(fixture.kickoff_utc) : null;
    const validDate = date && Number.isFinite(date.getTime());
    const shortDate = validDate ? result ?
        `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}` :
        `${date.toLocaleDateString('ko-KR', {weekday: 'short'}).replace('요일', '')} ` +
        date.toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', hour12: false}) : '';
    const fullDate = validDate ? date.toLocaleString('ko-KR',
        {year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit'}) : '날짜 미확인';
    const fullNames = `${fixture?.home ?? '홈 팀 미확인'} 대 ${fixture?.away ?? '원정 팀 미확인'}`;
    const accessibleName = `${fullDate}, ${fullNames}${direction ? `, 감시 팀 ${direction}` : ''}` +
        (result ? `, 홈 ${fixture?.home_score ?? '미확인'} 대 원정 ${fixture?.away_score ?? '미확인'}` : '');
    return {primary, direction, score, shortDate, fullDate, crestSide: oneSide,
        watchedName: oneSide ? displayTeam(fixture, oneSide) : null, accessibleName};
}
