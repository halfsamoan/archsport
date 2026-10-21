import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// GJS-only module: live-display invariants are guarded at the source level.
const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');

test('a finished match stays on the notch as 경기 종료 during the worker window', () => {
    // The worker sends a finished match as visible only inside its short final-score window.
    assert.match(source, /\['live', 'halftime', 'extra_time', 'penalties', 'interrupted', 'finished'\]\.includes\(match\?\.status\)\);/);
    assert.match(source, /finished: '경기 종료'/);
    assert.match(source, /match\?\.status === 'finished' \? '종료'/);
});
