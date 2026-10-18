import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOCK_PROTOCOL, layoutNotches, canClaim} from '../extension/dockModel.js';
import {enqueuePendingAlert, expirePendingAlerts, restorePendingAlerts, takePendingAlert} from '../extension/alertQueue.js';

test('sport and memory notches share a centered row', () => {
    assert.equal(DOCK_PROTOCOL, 2);
    const [sport, memory] = layoutNotches([
        {id: 'archsport', width: 360, order: 0},
        {id: 'matci', width: 220, order: 1},
    ], {x: 0, y: 0, width: 1728, panelHeight: 32});
    assert.equal(memory.x - sport.x - sport.width, 8);
    assert.equal(sport.x + (sport.width + memory.width + 8) / 2, 864);
    assert.equal(sport.y, 32);
});

test('manual memory review keeps priority over sport event', () => {
    assert.equal(canClaim({id: 'matci', priority: 100}, 'archsport', 80), false);
    const [sport, memory] = layoutNotches([
        {id: 'archsport', width: 500, order: 0},
        {id: 'matci', width: 220, order: 1, active: true},
    ], {x: 0, y: 0, width: 600, panelHeight: 32});
    assert.equal(sport.fallback, true);
    assert.equal(memory.fallback, false);
});

test('sport event stays queued while memory review owns the notch', () => {
    const queue = [];
    const alert = {kind: 'score', fingerprint: 'fixture:revision:1'};
    enqueuePendingAlert(queue, alert, 123);
    enqueuePendingAlert(queue, alert, 456);
    assert.equal(takePendingAlert(queue, () => canClaim({id: 'matci', priority: 100}, 'archsport', 80), 123), null);
    assert.deepEqual(queue, [{...alert, queued_at: 123}]);
    assert.deepEqual(takePendingAlert(queue, () => canClaim(null, 'archsport', 80), 123), {...alert, queued_at: 123});
    assert.deepEqual(queue, []);
});

test('restores only recent alerts still tied to a known fixture', () => {
    const now = 1_800_000_000_000;
    const fixture = {id: 'match:barcelona:sevilla:20300101', kickoff_utc: '2030-01-01T12:00:00Z'};
    const current = {...fixture, kind: 'score', match_id: fixture.id};
    const staleFixture = {...current, match_id: 'match:barcelona:betis:20300101'};
    const record = {saved_at: now - 1000, alerts: [current, staleFixture]};
    assert.deepEqual(restorePendingAlerts(record, {match: fixture}, now), [{...current, queued_at: record.saved_at}]);
    assert.deepEqual(restorePendingAlerts({...record, saved_at: now - 3 * 60 * 60 * 1000}, {match: fixture}, now), []);
    assert.deepEqual(restorePendingAlerts({...record, saved_at: now + 1}, {match: fixture}, now), []);
    assert.deepEqual(restorePendingAlerts(record, {match: {...fixture, kickoff_utc: 'different'}}, now), []);
});

test('expires in-memory alerts while another notch or overview delays presentation', () => {
    const queuedAt = 1_800_000_000_000;
    const now = queuedAt + 2 * 60 * 60 * 1000 + 1;
    const queue = [{kind: 'score', queued_at: queuedAt}, {kind: 'status', queued_at: now}];
    assert.equal(expirePendingAlerts(queue, now), 1);
    assert.deepEqual(queue, [{kind: 'status', queued_at: now}]);
    assert.equal(takePendingAlert(queue, () => false, now + 2 * 60 * 60 * 1000 + 2), null);
    assert.deepEqual(queue, []);
});

test('adding a new alert does not extend the lifetime of older queued alerts', () => {
    const queuedAt = 1_800_000_000_000;
    const now = queuedAt + 2 * 60 * 60 * 1000 + 1000;
    const fixture = {id: 'match:barcelona:sevilla:20300101', kickoff_utc: '2030-01-01T12:00:00Z'};
    const oldAlert = {...fixture, match_id: fixture.id, kind: 'score', fingerprint: 'old'};
    const newAlert = {...fixture, match_id: fixture.id, kind: 'status', fingerprint: 'new'};
    const queue = [];
    enqueuePendingAlert(queue, oldAlert, queuedAt);
    enqueuePendingAlert(queue, newAlert, now - 60_000);
    const restored = restorePendingAlerts({saved_at: now, alerts: queue}, {match: fixture}, now);
    assert.deepEqual(restored, [{...newAlert, queued_at: now - 60_000}]);
});
