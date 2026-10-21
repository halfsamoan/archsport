const DISPLAY_NAMES = new Map([
    ['paris saint germain fc', 'PSG'], ['paris saint germain', 'PSG'],
    ['fc barcelona', 'Barcelona'], ['barcelona', 'Barcelona'],
    ['como 1907', 'Como'], ['como 1907 fc', 'Como'], ['como', 'Como'],
    ['manchester united fc', 'Man United'], ['manchester united', 'Man United'],
    ['ss lazio', 'Lazio'], ['lazio', 'Lazio'],
    ['parma calcio 1913', 'Parma'], ['parma', 'Parma'],
    ['real betis balompie', 'Betis'], ['real betis', 'Betis'],
    ['feyenoord rotterdam', 'Feyenoord'], ['feyenoord', 'Feyenoord'],
    ['juventus fc', 'Juventus'], ['juventus', 'Juventus'],
    ['fc internazionale milano', 'Inter'], ['inter', 'Inter'],
    ['ac milan', 'Milan'], ['ssc napoli', 'Napoli'], ['as roma', 'Roma'],
    ['atalanta bc', 'Atalanta'], ['acf fiorentina', 'Fiorentina'],
    ['real madrid cf', 'Real Madrid'], ['club atletico de madrid', 'Atlético'],
    ['sevilla fc', 'Sevilla'], ['villarreal cf', 'Villarreal'], ['valencia cf', 'Valencia'],
    ['athletic club', 'Athletic'], ['real sociedad de futbol', 'Real Sociedad'],
    ['rc celta de vigo', 'Celta'], ['girona fc', 'Girona'], ['rcd espanyol de barcelona', 'Espanyol'],
]);
const WATCHED_IDS = new Map([[529, 'barcelona'], [487, 'lazio'], [895, 'como']]);
const WATCHED_NAMES = new Map([
    ['fc barcelona', 'barcelona'], ['barcelona', 'barcelona'],
    ['ss lazio', 'lazio'], ['lazio', 'lazio'],
    ['como 1907', 'como'], ['como 1907 fc', 'como'], ['como', 'como'],
]);
// Club-form words that say nothing about which club it is.
const GENERIC_WORDS = new Set(['fc', 'cf', 'ac', 'as', 'ss', 'ssc', 'sc', 'afc', 'cd', 'rc', 'rcd', 'ud',
    'sd', 'bc', 'calcio', 'club', 'de', 'del', 'la', 'futbol', 'football', 'balompie', 'us']);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const OUTCOME = {win: '승', draw: '무', loss: '패'};
const OUTCOME_SPOKEN = {win: '승리', draw: '무승부', loss: '패배'};

function normalized(value) {
    return String(value ?? '').toLowerCase().normalize('NFKD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function displayTeam(fixture, side) {
    const id = Number(fixture?.[`${side}_id`]);
    if (WATCHED_IDS.has(id))
        return {barcelona: 'Barcelona', lazio: 'Lazio', como: 'Como'}[WATCHED_IDS.get(id)];
    const original = String(fixture?.[side] ?? '—');
    return DISPLAY_NAMES.get(normalized(original)) ?? original;
}

// Typographic stand-in for a missing crest: initials of a multi-word name (PSG, MU) or the
// first three letters of a single word (SEV). Text only, never an invented emblem.
export function teamCode(fixture, side) {
    const words = normalized(displayTeam(fixture, side)).split(' ')
        .filter(word => word && !GENERIC_WORDS.has(word) && !/^\d+$/.test(word));
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 3).map(word => word[0]).join('').toUpperCase();
}

function watchedKey(fixture, side) {
    const id = Number(fixture?.[`${side}_id`]);
    if (WATCHED_IDS.has(id)) return WATCHED_IDS.get(id);
    const index = side === 'home' ? 0 : 1;
    return WATCHED_NAMES.get(normalized(fixture?.team_keys?.[index])) ??
        WATCHED_NAMES.get(normalized(fixture?.[side]));
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const twoDigits = value => String(value).padStart(2, '0');

// Upcoming: '오늘 21:00', '내일 04:00', or '10.23(목) 04:00' so a fixture two weeks out never
// reads as this week's weekday. Results: '어제' or '10.19'.
export function fixtureDate(date, now, result) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const day = `${date.getMonth() + 1}.${twoDigits(date.getDate())}`;
    if (result) return sameDay(date, now) ? '오늘' : sameDay(date, yesterday) ? '어제' : day;
    const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
    if (sameDay(date, now)) return `오늘 ${time}`;
    if (sameDay(date, tomorrow)) return `내일 ${time}`;
    return `${day}(${WEEKDAYS[date.getDay()]}) ${time}`;
}

function outcomeOf(own, other) {
    if (!Number.isInteger(own) || !Number.isInteger(other)) return null;
    return own > other ? 'win' : own < other ? 'loss' : 'draw';
}

export function fixturePresentation(fixture, watchedTeams, {result = false, spoiler = false, now = new Date()} = {}) {
    const watched = new Set(watchedTeams.map(value => WATCHED_NAMES.get(normalized(value)) ?? normalized(value)));
    const sides = ['home', 'away'].filter(side => watched.has(watchedKey(fixture, side)));
    const oneSide = sides.length === 1 ? sides[0] : null;
    const opponent = oneSide === 'home' ? 'away' : 'home';
    const primary = oneSide ? displayTeam(fixture, opponent) :
        `${displayTeam(fixture, 'home')} — ${displayTeam(fixture, 'away')}`;
    const direction = oneSide ? oneSide === 'home' ? '홈' : '원정' : '';
    // A watched club's result reads from its own side: its goals first, then 승/무/패.
    // Fixtures without exactly one watched side keep the official home : away order.
    const ownGoals = oneSide ? fixture?.[`${oneSide}_score`] : fixture?.home_score;
    const otherGoals = oneSide ? fixture?.[`${opponent}_score`] : fixture?.away_score;
    const outcomeKind = result && !spoiler && oneSide ? outcomeOf(ownGoals, otherGoals) : null;
    const score = spoiler ? '' : `${ownGoals ?? '–'} : ${otherGoals ?? '–'}`;
    const date = fixture?.kickoff_utc ? new Date(fixture.kickoff_utc) : null;
    const validDate = date && Number.isFinite(date.getTime());
    const shortDate = validDate ? fixtureDate(date, now, result) : '';
    const fullDate = validDate ? date.toLocaleString('ko-KR',
        {year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit'}) : '날짜 미확인';
    let accessibleName;
    if (oneSide) {
        accessibleName = `${fullDate}, ${fixture?.[oneSide] ?? '감시 팀'} ${direction} 경기, 상대 ${fixture?.[opponent] ?? '미확인'}`;
        if (result) {
            accessibleName += fixture?.result_pending ? ', 결과 확인 중' : spoiler ? ', 결과 숨김' :
                `, ${ownGoals ?? '미확인'} 대 ${otherGoals ?? '미확인'}${outcomeKind ? ` ${OUTCOME_SPOKEN[outcomeKind]}` : ''}`;
        }
    } else {
        accessibleName = `${fullDate}, 홈 ${fixture?.home ?? '미확인'} 대 원정 ${fixture?.away ?? '미확인'}`;
        if (result) {
            accessibleName += spoiler ? ', 결과 숨김' :
                `, 홈 ${fixture?.home_score ?? '미확인'} 대 원정 ${fixture?.away_score ?? '미확인'}`;
        }
    }
    return {primary, direction, score, outcome: outcomeKind ? OUTCOME[outcomeKind] : '', outcomeKind,
        shortDate, fullDate, crestSide: oneSide, watchedBoth: sides.length === 2,
        watchedName: oneSide ? displayTeam(fixture, oneSide) : null, accessibleName};
}
