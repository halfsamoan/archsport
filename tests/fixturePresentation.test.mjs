import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayTeam, fixturePresentation} from '../extension/fixturePresentation.js';

test('one watched side shows opponent but retains full match and score order', () => {
    const fixture = {home: 'Real Betis Balompié', away: 'FC Barcelona', away_id: 529,
        home_score: 2, away_score: 5, kickoff_utc: '2026-10-18T20:00:00Z',
        team_keys: [null, 'barcelona']};
    const row = fixturePresentation(fixture, ['Barcelona'], {result: true});
    assert.equal(row.primary, 'Betis');
    assert.equal(row.direction, '원정');
    assert.equal(row.crestSide, 'away');
    assert.equal(row.score, '2 : 5');
    assert.match(row.accessibleName, /홈 Real Betis Balompié 대 원정 FC Barcelona/);
    assert.match(row.accessibleName, /홈 2 대 원정 5/);
    const hidden = fixturePresentation(fixture, ['Barcelona'], {result: true, spoiler: true});
    assert.equal(hidden.score, '● : ●');
    assert.doesNotMatch(hidden.accessibleName, /홈 2 대 원정 5/);
    assert.match(hidden.accessibleName, /점수 숨김/);
    assert.equal(displayTeam({home: 'Unknown Town'}, 'home'), 'Unknown Town');
});

test('both watched or neither identified retain both team names', () => {
    const both = {home: 'SS Lazio', away: 'Como 1907', team_keys: ['lazio', 'como']};
    assert.equal(fixturePresentation(both, ['Lazio', 'Como']).primary, 'Lazio — Como');
    assert.equal(fixturePresentation(both, ['Lazio', 'Como']).crestSide, null);
    assert.match(fixturePresentation(both, ['Lazio', 'Como']).accessibleName, /홈 SS Lazio 대 원정 Como 1907$/);
    const neither = {home: 'Paris Saint-Germain FC', away: 'Manchester United FC'};
    assert.equal(fixturePresentation(neither, ['Barcelona']).primary, 'PSG — Man United');
});
