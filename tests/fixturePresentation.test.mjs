import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayTeam, fixtureDate, fixturePresentation, teamCode} from '../extension/fixturePresentation.js';

test('a watched result reads from the watched side with 승/무/패', () => {
    const fixture = {home: 'Real Betis Balompié', away: 'FC Barcelona', away_id: 529,
        home_score: 2, away_score: 5, kickoff_utc: '2026-10-18T20:00:00Z',
        team_keys: [null, 'barcelona']};
    const row = fixturePresentation(fixture, ['Barcelona'], {result: true});
    assert.equal(row.primary, 'Betis');
    assert.equal(row.direction, '원정');
    assert.equal(row.crestSide, 'away');
    // Barcelona scored 5 away: its goals come first, so '2 : 5' can no longer read as a loss.
    assert.equal(row.score, '5 : 2');
    assert.equal(row.outcome, '승');
    assert.equal(row.outcomeKind, 'win');
    assert.match(row.accessibleName, /FC Barcelona 원정 경기, 상대 Real Betis Balompié, 5 대 2 승리$/);
    const loss = fixturePresentation({...fixture, home_score: 3, away_score: 0}, ['Barcelona'], {result: true});
    assert.deepEqual([loss.score, loss.outcome], ['0 : 3', '패']);
    const draw = fixturePresentation({...fixture, home_score: 1, away_score: 1}, ['Barcelona'], {result: true});
    assert.deepEqual([draw.score, draw.outcome], ['1 : 1', '무']);
    const unknown = fixturePresentation({...fixture, home_score: null}, ['Barcelona'], {result: true});
    assert.deepEqual([unknown.score, unknown.outcome], ['5 : –', '']);
    const hidden = fixturePresentation(fixture, ['Barcelona'], {result: true, spoiler: true});
    assert.deepEqual([hidden.score, hidden.outcome], ['', '']);
    assert.doesNotMatch(hidden.accessibleName, /5 대 2|승리/);
    assert.match(hidden.accessibleName, /결과 숨김/);
    assert.equal(displayTeam({home: 'Unknown Town'}, 'home'), 'Unknown Town');
    assert.equal(displayTeam({home: 'Juventus FC'}, 'home'), 'Juventus');
});

test('both watched or neither identified keep official home : away order without 승패', () => {
    const both = {home: 'SS Lazio', away: 'Como 1907', team_keys: ['lazio', 'como'], home_score: 2, away_score: 0};
    const row = fixturePresentation(both, ['Lazio', 'Como'], {result: true});
    assert.equal(row.primary, 'Lazio — Como');
    assert.equal(row.crestSide, null);
    assert.equal(row.watchedBoth, true);
    assert.equal(row.score, '2 : 0');
    assert.equal(row.outcome, '');
    assert.match(row.accessibleName, /홈 SS Lazio 대 원정 Como 1907, 홈 2 대 원정 0$/);
    const neither = {home: 'Paris Saint-Germain FC', away: 'Manchester United FC'};
    assert.equal(fixturePresentation(neither, ['Barcelona']).primary, 'PSG — Man United');
    assert.equal(fixturePresentation(neither, ['Barcelona']).watchedBoth, false);
});

test('upcoming dates say today/tomorrow or carry the day, results stay short', () => {
    const now = new Date(2026, 9, 21, 9, 0);
    assert.equal(fixtureDate(new Date(2026, 9, 21, 21, 0), now, false), '오늘 21:00');
    assert.equal(fixtureDate(new Date(2026, 9, 22, 4, 5), now, false), '내일 04:05');
    assert.equal(fixtureDate(new Date(2026, 10, 3, 4, 0), now, false), '11.03(화) 04:00');
    assert.equal(fixtureDate(new Date(2026, 9, 20, 22, 0), now, true), '어제');
    assert.equal(fixtureDate(new Date(2026, 9, 18, 22, 0), now, true), '10.18');
});

test('missing crests fall back to readable club initials, never an emblem', () => {
    assert.equal(teamCode({away: 'Sevilla FC'}, 'away'), 'SEV');
    assert.equal(teamCode({home: 'Paris Saint-Germain FC'}, 'home'), 'PSG');
    assert.equal(teamCode({home: 'Manchester United FC'}, 'home'), 'MU');
    assert.equal(teamCode({home: 'Real Madrid CF'}, 'home'), 'RM');
    assert.equal(teamCode({home: 'AC Milan'}, 'home'), 'MIL');
    assert.equal(teamCode({home: 'Parma Calcio 1913'}, 'home'), 'PAR');
    assert.equal(teamCode({home: ''}, 'home'), '?');
});

test('rows name the competition in short form beside home/away', async () => {
    const {competitionLabel} = await import('../extension/fixturePresentation.js');
    assert.equal(competitionLabel({competition_code: 'CL', competition: 'UEFA Champions League'}), 'UCL');
    assert.equal(competitionLabel({competition: 'Primera Division'}), '라리가');
    assert.equal(competitionLabel({competition: 'Serie A'}), '세리에 A');
    assert.equal(competitionLabel({competition: 'Copa del Rey'}), '코파 델 레이');
    assert.equal(competitionLabel({competition: 'Some Friendly Cup'}), 'Some Friendly Cup');
    assert.equal(competitionLabel({}), '');
    const row = fixturePresentation({home: 'FC Barcelona', away: 'Real Madrid CF', home_id: 529,
        competition_code: 'PD', kickoff_utc: '2026-10-26T20:00:00Z'}, ['Barcelona']);
    assert.equal(row.competition, '라리가');
    assert.equal(row.direction, '홈');
    assert.match(row.accessibleName, /, 라리가, FC Barcelona 홈 경기, 상대 Real Madrid CF$/);
});
