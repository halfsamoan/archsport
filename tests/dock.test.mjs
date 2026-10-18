import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutNotches, canClaim} from '../extension/dockModel.js';

const monitor = {x: 100, y: 0, width: 1280, panelHeight: 32};
test('two islands form one centered group below panel without overlap', () => {
    const positions = layoutNotches([{id: 'sports', width: 360, height: 46, order: 0},
        {id: 'memory', width: 220, height: 46, order: 1}], monitor);
    assert.equal(positions.length, 2);
    assert.equal(positions[0].y, 32);
    assert.equal(positions[1].x - positions[0].x - positions[0].width, 8);
    assert.equal(positions[0].x + (360 + 220 + 8) / 2, 740);
});
test('narrow display preserves active participant and falls back companion', () => {
    const positions = layoutNotches([{id: 'sports', width: 500, height: 250, order: 0, active: true},
        {id: 'memory', width: 220, height: 46, order: 1}], {...monitor, width: 600});
    assert.equal(positions.find(x => x.id === 'memory').fallback, true);
    assert.equal(positions.find(x => x.id === 'sports').fallback, false);
});
test('single notch recenters and clamps to monitor', () => {
    const [position] = layoutNotches([{id: 'memory', width: 500, height: 250}], {...monitor, width: 390});
    assert.equal(position.width, 366);
    assert.equal(position.x, 112);
});
test('manual review is not interrupted by automatic events', () => {
    assert.equal(canClaim({id: 'memory', priority: 100}, 'sports', 80), false);
    assert.equal(canClaim({id: 'memory', priority: 30}, 'sports', 80), true);
    assert.equal(canClaim({id: 'memory', priority: 100}, 'sports', 100), true);
});
