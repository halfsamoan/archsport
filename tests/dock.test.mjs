import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutNotches, canClaim, enqueuePendingAlert, takePendingAlert} from '../extension/dockModel.js';

test('sport and memory notches share a centered row', () => {
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
    enqueuePendingAlert(queue, alert);
    enqueuePendingAlert(queue, alert);
    assert.equal(takePendingAlert(queue, () => canClaim({id: 'matci', priority: 100}, 'archsport', 80)), null);
    assert.deepEqual(queue, [alert]);
    assert.deepEqual(takePendingAlert(queue, () => canClaim(null, 'archsport', 80)), alert);
    assert.deepEqual(queue, []);
});
