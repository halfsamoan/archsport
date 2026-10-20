import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOCK_PROTOCOL, buttonNumber, layoutNotches, canClaim, isActorWithin, isPointWithinActor, pointInNotchShape,
    classifyOutsideSurface, dispatchOutsideDismiss} from '../extension/dockModel.js';
import {calculateExpandedViewport, scoreDirection, eventSummary} from '../extension/uiModel.js';

test('score event celebrates only a verified watched-team increase', () => {
    const previous = {id: 'm1', home: 'Barcelona', away: 'Opponent', home_score: 1, away_score: 1,
        team_keys: ['barcelona', 'opponent']};
    assert.equal(scoreDirection(previous, {...previous, home_score: 2}, ['Barcelona']), 'watched');
    assert.equal(scoreDirection(previous, {...previous, away_score: 2}, ['Barcelona']), 'opponent');
    assert.equal(scoreDirection(previous, {...previous, home_score: 2, away_score: 2}, ['Barcelona']), 'unknown');
    assert.equal(scoreDirection(previous, {...previous, id: 'm2', home_score: 2}, ['Barcelona']), 'unknown');
    assert.equal(scoreDirection(previous, {...previous, home_score: null}, ['Barcelona']), 'unknown');
});

test('event summary stays readable with extra time and missing provider fields', () => {
    assert.equal(eventSummary({kind: 'Goal', elapsed: 90, extra: 3, player: 'A. Player',
        detail: 'Normal Goal'}), '90+3′ · A. Player');
    assert.equal(eventSummary({kind: 'Goal', elapsed: 74, player: '', detail: 'Own Goal'}), '74′ · Own Goal');
    assert.equal(eventSummary({kind: 'Var', detail: 'Goal cancelled'}), 'Goal cancelled');
    assert.equal(eventSummary({}), '경기 상황');
});
import {enqueuePendingAlert, expirePendingAlerts, restorePendingAlerts, takePendingAlert} from '../extension/alertQueue.js';

test('sport and memory notches share a centered row', () => {
    assert.equal(DOCK_PROTOCOL, 5);
    const [sport, memory] = layoutNotches([
        {id: 'archsport', width: 360, order: 0},
        {id: 'matci', width: 220, order: 1},
    ], {x: 0, y: 0, width: 1728, panelHeight: 32});
    assert.equal(memory.x - sport.x - sport.width, 6);
    assert.equal(sport.x + (sport.width + memory.width + 6) / 2, 864);
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

test('equal-priority manual open follows last-toggle ownership', () => {
    assert.equal(canClaim({id: 'matci', priority: 100}, 'archsport', 100), true);
});

test('button extraction supports direct and tuple GI return values', () => {
    assert.equal(buttonNumber(1), 1);
    assert.equal(buttonNumber([true, 3]), 3);
    assert.equal(buttonNumber([false, 0]), 0);
});

test('only outside primary and secondary clicks dismiss while preserving other targets', () => {
    let dismissed = 0;
    for (const button of [1, 3]) {
        assert.equal(dispatchOutsideDismiss({eventType: 4, buttonPressType: 4, button,
            active: true, expanded: true}, () => dismissed++), true);
    }
    assert.equal(dismissed, 2);
    for (const input of [
        ...[2, 4, 5].map(button => ({eventType: 4, buttonPressType: 4, button,
            active: true, expanded: true})),
        {eventType: 5, buttonPressType: 4, active: true, expanded: true},
        {eventType: 4, buttonPressType: 4, active: false, expanded: true},
        {eventType: 4, buttonPressType: 4, active: true, expanded: false},
        {eventType: 4, buttonPressType: 4, button: 1,
            active: true, expanded: true, insideDock: true},
    ]) {
        assert.equal(dispatchOutsideDismiss(input, () => dismissed++), false);
    }
    assert.equal(dispatchOutsideDismiss({eventType: 4, buttonPressType: 4, button: 1,
        active: true, expanded: true}, () => dismissed++, {insideOwnerTrigger: true}), false);
    assert.equal(dispatchOutsideDismiss({eventType: 4, buttonPressType: 4, button: 1,
        active: true, expanded: true}, () => {}, {insideOwnerTrigger: false}), true);
    assert.equal(dismissed, 2);
});

test('outside-click hit testing includes descendant controls and blank actor bounds', () => {
    const root = {get_parent: () => null,
        get_transformed_position: () => [100, 20], get_transformed_size: () => [400, 80]};
    const button = {get_parent: () => root};
    assert.equal(isActorWithin(button, root), true);
    assert.equal(isPointWithinActor(root, 101, 21), true);
    assert.equal(isPointWithinActor(root, 500, 100), true);
    assert.equal(isPointWithinActor(root, 501, 100), false);
});

test('transparent shoulder corners are outside while neck and body accept input', () => {
    assert.equal(pointInNotchShape(4, 4, 388, 250), false);
    assert.equal(pointInNotchShape(194, 4, 388, 250), true);
    assert.equal(pointInNotchShape(35, 26, 388, 250), false);
    assert.equal(pointInNotchShape(190, 26, 388, 250), true);
    assert.equal(pointInNotchShape(190, 220, 388, 250), true);
    assert.equal(pointInNotchShape(0, 250, 388, 250), false);
});

test('only the active notch trigger is exempt from outside dismissal', () => {
    const actor = (x, y, width, height, parent = null) => ({get_parent: () => parent,
        get_transformed_position: () => [x, y], get_transformed_size: () => [width, height]});
    const dock = actor(100, 20, 400, 80);
    const ownerTrigger = actor(20, 0, 50, 32);
    const otherTrigger = actor(600, 0, 50, 32);
    const ownerClick = classifyOutsideSurface({dockActor: dock, ownerTrigger,
        eventSource: actor(25, 5, 5, 5, ownerTrigger), x: 30, y: 10});
    assert.deepEqual(ownerClick, {insideDock: false, insideOwnerTrigger: true});
    const otherClick = classifyOutsideSurface({dockActor: dock, ownerTrigger,
        eventSource: actor(605, 5, 5, 5, otherTrigger), x: 610, y: 10});
    assert.deepEqual(otherClick, {insideDock: false, insideOwnerTrigger: false});
    assert.equal(dispatchOutsideDismiss({eventType: 4, buttonPressType: 4, button: 1, active: true,
        expanded: true}, () => {}, otherClick), true);
});

test('expanded fixture list scrolls within the monitor while short content stays compact', () => {
    const short = calculateExpandedViewport({monitorHeight: 900, panelHeight: 32,
        headerHeight: 40, contentHeight: 100});
    assert.equal(short.bodyHeight, 100);
    assert.equal(short.rootHeight, 172);
    assert.equal(short.scrollable, false);
    const long = calculateExpandedViewport({monitorHeight: 450, panelHeight: 32,
        headerHeight: 44, contentHeight: 900});
    assert.equal(long.bodyHeight, 318);
    assert.equal(long.rootHeight, 394);
    assert.equal(long.scrollable, true);
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
