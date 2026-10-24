import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOCK_PROTOCOL, SNAP, GRAB_PRIORITY, buttonNumber, layoutIsland, canClaim, needsGrab, isActorWithin, isPointWithinActor,
    pointInNotchShape, classifyOutsideSurface, dispatchOutsideDismiss, notchGeometry} from '../extension/dockModel.js';
import {calculateExpandedViewport, scoreDirection, eventSummary, alertAnnouncement} from '../extension/uiModel.js';

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
        detail: 'Normal Goal'}), '골 · 90+3′ · A. Player');
    assert.equal(eventSummary({kind: 'Goal', elapsed: 74, player: '', detail: 'Own Goal'}), '자책골 · 74′');
    assert.equal(eventSummary({kind: 'Var', detail: 'Goal cancelled'}), 'VAR 골 취소');
    assert.equal(eventSummary({kind: 'Card', elapsed: 58, player: 'Gavi', detail: 'Yellow Card'}), '경고 · 58′ · Gavi');
    assert.equal(eventSummary({kind: 'subst', elapsed: 70, player: 'Pedri', detail: 'Substitution 1'}), '교체 · 70′ · Pedri');
    assert.equal(eventSummary({}), '경기 상황');
});

test('goal announcements include score and scorer except in spoiler mode', () => {
    const alert = {kind: 'score', title: '스코어 변경', fingerprint: 'goal-1'};
    // The event list accounts for all three goals; a shorter list names no scorer (liveDisplay test).
    const match = {home: 'Barcelona', away: 'Como', home_score: 2, away_score: 1,
        events: [{kind: 'Goal', elapsed: 12, player: 'B. Player', detail: 'Normal Goal'},
            {kind: 'Goal', elapsed: 40, player: 'C. Player', detail: 'Penalty'},
            {kind: 'Goal', elapsed: 61, player: 'A. Player', detail: 'Normal Goal'}]};
    const full = alertAnnouncement(alert, match);
    assert.match(full, /Barcelona 2 대 1 Como/);
    assert.match(full, /골 · 61′ · A\. Player/);
    const hidden = alertAnnouncement(alert, match, true);
    assert.equal(hidden, '스코어 변경 알림');
    assert.doesNotMatch(hidden, /Barcelona|Como|2|1|A\. Player/);
    assert.equal(alertAnnouncement({kind: 'kickoff', title: '15분 후 경기', club: 'Barcelona', opponent: 'Como'}, match, true),
        '15분 후 경기 알림');
});
import {enqueuePendingAlert, expirePendingAlerts, restorePendingAlerts, takePendingAlert} from '../extension/alertQueue.js';

test('compact modules share one island row below the panel', () => {
    assert.equal(DOCK_PROTOCOL, 7);
    const {island, slots} = layoutIsland([
        {id: 'archsport@local', width: 200, height: 36, order: 0},
        {id: 'notci@local/spotify', width: 56, height: 36, order: 2},
    ], {x: 0, y: 0, width: 1728, panelHeight: 32});
    assert.deepEqual(island, {x: 730, y: 32, width: 268, height: 36, expanded: false, ownerId: null});
    assert.deepEqual(slots.get('archsport@local'), {x: 0, width: 200, shown: true});
    assert.deepEqual(slots.get('notci@local/spotify'), {x: 212, width: 56, shown: true});
    // Compact widths snap so a one-pixel text change never shifts the row.
    assert.equal(SNAP, 8);
    assert.equal(layoutIsland([{id: 'a', width: 61, height: 36}], {x: 0, y: 0, width: 1728}).slots.get('a').width, 64);
    assert.equal(layoutIsland([{id: 'a', width: 65, height: 36}], {x: 0, y: 0, width: 1728}).slots.get('a').width, 72);
});

test('an expanded owner has the island to itself at its exact size', () => {
    const {island, slots} = layoutIsland([
        {id: 'archsport@local', width: 200, height: 36, order: 0},
        {id: 'matci@local', width: 368, height: 240, order: 1, expanded: true, active: true},
    ], {x: 0, y: 0, width: 1728, panelHeight: 32});
    assert.deepEqual(island, {x: 680, y: 32, width: 368, height: 240, expanded: true, ownerId: 'matci@local'});
    assert.equal(slots.get('archsport@local').shown, false);
    assert.equal(slots.get('matci@local').shown, true);
    // An owner wider than the monitor is clamped, never snapped.
    const narrow = layoutIsland([{id: 'matci@local', width: 500, height: 250, expanded: true}], {x: 100, y: 0, width: 390});
    assert.equal(narrow.island.width, 366);
    assert.equal(narrow.island.x, 112);
});

test('manual memory review keeps priority over sport event', () => {
    assert.equal(canClaim({id: 'matci', priority: 100}, 'archsport', 80), false);
    // Alert ladder: goal 80 > KakaoTalk 60 > Spotify peek 40 > matci suggestion 30.
    assert.equal(canClaim({id: 'archsport', priority: 80}, 'kakao', 60), false);
    assert.equal(canClaim({id: 'kakao', priority: 60}, 'spotify', 40), false);
    assert.equal(canClaim({id: 'matci', priority: 30}, 'spotify', 40), true);
    // Too narrow for the compact row: the active module stays, the companion is hidden.
    const {island, slots} = layoutIsland([
        {id: 'archsport', width: 500, height: 36, order: 0},
        {id: 'matci', width: 220, height: 36, order: 1, active: true},
    ], {x: 0, y: 0, width: 600, panelHeight: 32});
    assert.equal(island.width, 224);
    assert.equal(slots.get('archsport').shown, false);
    assert.equal(slots.get('matci').shown, true);
    assert.equal(layoutIsland([], {x: 0, y: 0, width: 600}).island, null);
});

test('equal-priority manual open follows last-toggle ownership', () => {
    assert.equal(canClaim({id: 'matci', priority: 100}, 'archsport', 100), true);
});

test('only a manually opened card holds the stage grab; toasts never steal clicks or keys', () => {
    const open = {visible: true, expanded: true};
    assert.equal(GRAB_PRIORITY, 100);
    assert.equal(needsGrab({id: 'archsport', priority: 100}, open), true);
    for (const priority of [80, 60, 50, 40, 30]) assert.equal(needsGrab({id: 'x', priority}, open), false);
    assert.equal(needsGrab({id: 'archsport', priority: 100}, {visible: true, expanded: false}), false);
    assert.equal(needsGrab({id: 'archsport', priority: 100}, {visible: false, expanded: true}), false);
    assert.equal(needsGrab(null, open), false);
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

test('slab geometry: short ears, rounded bottom, rounded seed drop', () => {
    assert.deepEqual(notchGeometry(34, 212), {ear: 6, radius: 15, sliver: false});
    assert.deepEqual(notchGeometry(250, 416), {ear: 14, radius: 22, sliver: false});
    assert.deepEqual(notchGeometry(6, 104), {ear: 1, radius: 3, sliver: false});   // the seed is a small rounded drop since v33
});

test('transparent ears and bottom corners are outside while the slab accepts input', () => {
    // 388 body + 2 × 14 ears.
    assert.equal(pointInNotchShape(4, 4, 416, 250), false);
    assert.equal(pointInNotchShape(10, 120, 416, 250), false);
    assert.equal(pointInNotchShape(208, 1, 416, 250), true);
    assert.equal(pointInNotchShape(15, 1, 416, 250), true);
    assert.equal(pointInNotchShape(20, 120, 416, 250), true);
    assert.equal(pointInNotchShape(20, 249, 416, 250), false);
    assert.equal(pointInNotchShape(208, 249, 416, 250), true);
    assert.equal(pointInNotchShape(0, 250, 416, 250), false);
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

test('re-enable keeps the worker generation monotonic so same-tick stale reads close their pipe', () => {
    // GJS-only module; guard the lifecycle invariant at the source level.
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /this\._generation = \(this\._generation \?\? 0\) \+ 1;/);
    assert.doesNotMatch(source, /this\._generation = 0;/);
});

test('worker error payloads do not reset restart backoff', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    const reader = source.slice(source.indexOf('    _readLine('), source.indexOf('    _stopWorker('));
    assert.match(reader, /if \(nextPayload\.health !== 'error'\) this\._failures = 0;/);
    assert.equal((reader.match(/this\._failures = 0;/g) ?? []).length, 1);
});

test('hit regions are placed by the slab layout, never from notify or style handlers', () => {
    const source = readFileSync(new URL('../extension/notchSurface.js', import.meta.url), 'utf8');
    // Setting child geometry from notify::width ran inside allocation and re-queued a relayout every morph frame.
    assert.match(source, /vfunc_allocate\(container, box\)/);
    assert.doesNotMatch(source, /updateHitRegions|margin_(left|right|top|bottom)/);
});

test('compact row fits the 34 px slab and the open notch has no forehead', async () => {
    const {DESIGN} = await import('../extension/designTokens.js');
    const css = readFileSync(new URL('../extension/stylesheet.css', import.meta.url), 'utf8');
    const [, compactY] = css.match(/\.archsport-notch \{[^}]*padding: (\d+)px \d+px;/);
    const [, button] = css.match(/\.archsport-compact-button \{ min-height: (\d+)px/);
    assert.equal(2 * Number(compactY) + Number(button), DESIGN.control.compactHeight);
    // Large Text grows the pill from its measured height instead of clipping pt-sized text.
    assert.doesNotMatch(css, /font-size: [\d.]+px/);
    const [, top, side, bottom] = css.match(/\.archsport-notch\.archsport-open \{ padding: (\d+)px (\d+)px (\d+)px;/).map(Number);
    assert.ok(top <= 12);
    // Island insets: the bottom never exceeds the sides, so the card sits concentric in the slab.
    assert.ok(bottom <= side);
    // The slab height comes from the root's real padding, not a hand-tuned constant.
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /chromeHeight: rootNode\.get_vertical_padding\(\) \+ rootNode\.get_length\('spacing'\)/);
    assert.match(source, /this\._contentHeight = viewport\.rootHeight;/);
    assert.match(source, /this\._compactHeight = Math\.max\(DESIGN\.control\.compactHeight, Math\.ceil\(compactNatural\)\);/);
});

test('content motion rides the slab curve and enters from the panel edge', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /import \{DockParticipant, easeOnCurve, closeEase, afterDispatch\} from '\.\/notchDock\.js';/);
    // The island draws the only slab; the app hands over its content tree.
    assert.doesNotMatch(source, /createNotchSurface|addChrome\(|removeChrome\(/);
    assert.match(source, /new DockParticipant\(\{id: this\.uuid, content: this\._root,/);
    assert.doesNotMatch(source, /\.ease\(\{/);
    assert.doesNotMatch(source, /EASE_OUT_CUBIC/);
    assert.match(source, /const drop = \{opacity: 0, translation_y: -DESIGN\.motion\.contentShift\};/);
});

test('entrances start after the slab shows the attached tree', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    const build = source.slice(source.indexOf('for (const child of this._root.get_children()) child.destroy();'),
        source.indexOf('        this._visibility();\n        // Entrances start'));
    assert.ok(build.length > 1000);
    // Score roll-up, crest pulse and event line are queued while the tree is built, never eased there.
    assert.doesNotMatch(build, /easeOnCurve\(|\.opacity = 0|translation_y = /);
    assert.match(source, /for \(const \[actor, from, to\] of entrances\) \{\n\s+Object\.assign\(actor, from\);\n\s+easeOnCurve\(actor, to\);/);
});

test('collapse rebuilds compact content while the slab is still shrinking', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    // v34: the card fades and shrinks for CLOSE_OUT_MS (only when a compact row follows; a slab retracting
    // out of sight fades the content itself), the dock fits the content then, and the compact row grows in
    // over CLOSE_IN_MS. Closes from Esc and the collapse button start after Clutter's event dispatch.
    assert.match(source, /this\._closingTimer = GLib\.timeout_add\(GLib\.PRIORITY_DEFAULT, CLOSE_OUT_MS,/);
    assert.match(source, /if \(this\._dock\.state\.visible\) \{\n\s+for \(const child of children\) \{\n\s+child\.set_pivot_point\(0\.5, 0\);\n\s+closeEase\(child, \{opacity: 0, scale_x: CONTENT_SHRINK_TO, scale_y: CONTENT_SHRINK_TO\}\);/);
    assert.doesNotMatch(source, /easeOnCurve\(child, \{opacity: 0, duration: DESIGN\.motion\.micro\}\)/);
    assert.match(source, /entrances\.push\(\[row, \{\.\.\.drop, scale_x: CONTENT_GROW_FROM, scale_y: CONTENT_GROW_FROM\},\n\s+\{\.\.\.settled, scale_x: 1, scale_y: 1, duration: CLOSE_IN_MS\}\]\);/);
    assert.match(source, /_closeAfterDispatch\(\) \{\n\s+afterDispatch\(this\._dock\.dock, \(\) => \{/);
    assert.match(source, /'pan-up-symbolic', '접기', \(\) => this\._closeAfterDispatch\(\)\)/);
    assert.match(source, /KEY_Escape[\s\S]*?this\._closeAfterDispatch\(\);\n\s+return Clutter\.EVENT_STOP;/);
});

test('expanded height is measured from styled actors without a fudge factor', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fixtureRows|bodyEstimate/);
    assert.ok(source.indexOf('ensureStyle(this._root);') < source.indexOf('expandedBody.get_preferred_height('));
    // The recursion is what styles unmapped descendants before measuring.
    assert.match(source, /actor\.ensure_style\?\.\(\);\n\s+actor\.get_children\(\)\.forEach\(ensureStyle\)/);
    assert.match(source, /contentHeight: bodyNatural,/);
});

test('fixture rows share a fixed lead column and shoot-out scores respect spoiler mode', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../extension/stylesheet.css', import.meta.url), 'utf8');
    assert.match(css, /\.archsport-fixture-lead \{ width: \d+px;/);
    // Schedule and result rows share one builder, so their columns cannot drift apart.
    assert.equal(source.match(/add_child\(this\._fixtureLead\(/g)?.length, 1);
    assert.equal(source.match(/this\._fixtureRow\(/g)?.length, 2);
    assert.match(source, /\} else if \(!spoiler && match\?\.home_penalties != null\) \{/);
    assert.match(source, /\$\{match\.home_penalties\} : \$\{match\.away_penalties\}`, 'archsport-result-score'\)/);
});

test('numpad toggle shortcut is bound on enable and released on disable', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    const schema = readFileSync(new URL('../extension/schemas/org.gnome.shell.extensions.archsport.gschema.xml', import.meta.url), 'utf8');
    assert.match(source, /addKeybinding\('archsport-toggle-shortcut'/);
    assert.match(source, /disable\(\) \{\n\s+this\._enabled = false;\n\s+Main\.wm\.removeKeybinding\('archsport-toggle-shortcut'\);/);
    assert.ok(schema.includes(`<key name="archsport-toggle-shortcut" type="as"><default>['KP_Enter']</default>`));
});

test('closing releases notch focus and only grabs the root while visible', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /import \{isActorWithin, CLOSE_OUT_MS, CLOSE_IN_MS, CONTENT_SHRINK_TO, CONTENT_GROW_FROM\} from '\.\/dockModel\.js';/);
    assert.match(source, /_returnWindow = global\.display\.get_focus_window\(\)/);
    assert.match(source, /_releaseFocus\(\) \{[\s\S]*?global\.stage\.set_key_focus\(null\);[\s\S]*?win\.focus\(global\.get_current_time\(\)\)/);
    assert.match(source, /if \(closing\) this\._releaseFocus\(\);/);
    assert.match(source, /if \(expanding && this\._dock\.state\.visible\) this\._focusPrimary\(\)/);
    assert.match(source, /if \(this\._dock\.state\.visible\) this\._focusPrimary\(\)/);
    // A non-reactive St root is :insensitive and never gets key events, so it must not hold focus
    // and Escape is handled at the stage while focus is inside the notch.
    assert.match(source, /reactive: false, can_focus: false,/);
    assert.doesNotMatch(source, /this\._root\.grab_key_focus\(\)/);
    assert.match(source, /global\.stage, 'key-press-event'[\s\S]*?KEY_Escape[\s\S]*?isActorWithin\(global\.stage\.get_key_focus\(\), this\._root\)/);
});

test('overview and hidden fullscreen collapse Archsport unless an alert is active', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /_onOverviewShowing\(\) \{\s*if \(this\._expanded && !this\._activeAlert\) \{\s*this\._expanded = false;\s*this\._render\(\);/);
    assert.match(source, /_onFullscreenChanged\(\) \{\s*if \(this\._settings\.get_boolean\('hide-fullscreen'\) && this\._monitor\(\)\?\.inFullscreen &&\s*this\._expanded && !this\._activeAlert\)/);
    assert.match(source, /Main\.overview, 'showing', \(\) => this\._onOverviewShowing\(\)/);
    assert.match(source, /this\._dock\.claim\(this\._expanded \? 100 : 80\)/);
});

test('keyboard focus stays in the notch after render rebuilds its controls', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /global\.focus_manager\.add_group\(this\._root\)/);
    assert.match(source, /const focusWasInside = isActorWithin\(global\.stage\.get_key_focus\(\), this\._root\);/);
    assert.match(source, /\(findFocusKey\(this\._root, focusedKey\) \?\? this\._primaryFocus \?\? firstFocusable\(this\._root\)\)\?\.grab_key_focus\(\)/);
    // Focusable information rows stay reactive, otherwise focus on them is a dead end too.
    assert.match(source, /'archsport-fixture-row', can_focus: true, reactive: true/);
    assert.match(source, /const firstFocusable = actor => \{[\s\S]*?child\.can_focus && child\.reactive/);
});

test('screen-reader notifications deduplicate alert keys and keep only the latest throttled alert', () => {
    const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
    assert.match(source, /_alertKey\(alert\) \{[\s\S]*?alert\?\.fingerprint/);
    assert.match(source, /this\._announcedAlertKeys\.has\(key\)[\s\S]*?this\._root\.get_accessible\(\)\?\.emit\('notification', text, Atk\.Live\.POLITE\)/);
    assert.match(source, /this\._queuedAnnouncement = alert/);
    assert.match(source, /this\._dock\?\.state\.visible/);
    assert.match(source, /if \(visible && this\._activeAlert\) this\._announceAlert\(this\._activeAlert\)/);
    assert.match(source, /alertAnnouncement\(alert, this\._payload\.match, this\._settings\.get_boolean\('spoiler'\)\)/);
});

test('every inset focus ring sits on a painted background (St skips inset shadows without one)', () => {
    // Generated CSS: template tokens contain braces that would split the rules.
    const css = readFileSync(new URL('../extension/stylesheet.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({selector: selector.trim(), body}));
    const painted = selector => rules.some(rule => rule.selector.split(',').map(s => s.trim()).includes(selector) &&
        /background-color:\s*(?!transparent)/.test(rule.body));
    for (const rule of rules.filter(rule => rule.selector.includes(':focus') && /box-shadow:\s*inset/.test(rule.body))) {
        for (const selector of rule.selector.split(',').map(s => s.trim())) {
            const base = selector.replace(':focus', '').split(' ')[0];
            assert.ok(/background-color:/.test(rule.body) || painted(base), `${selector} ring would be invisible`);
        }
    }
});

test('slab morphs ride a spring: growing overshoots ~2 % and settles, shrinking never overshoots', async () => {
    const {SPRING_OPEN, SPRING_CLOSE, springAt, springDuration} = await import('../extension/dockModel.js');
    const peak = spring => Math.max(...Array.from({length: 241}, (_, i) => springAt(i / 240, spring)));
    assert.equal(springAt(0, SPRING_OPEN), 0);
    assert.ok(peak(SPRING_OPEN) > 1.01 && peak(SPRING_OPEN) < 1.04, `open peak ${peak(SPRING_OPEN)}`);
    assert.ok(peak(SPRING_CLOSE) <= 1, `close peak ${peak(SPRING_CLOSE)}`);
    const open = springDuration(SPRING_OPEN);
    const close = springDuration(SPRING_CLOSE);
    assert.ok(open > 300 && open < 600, `open ${open} ms`);
    assert.ok(close > 200 && close < 450, `close ${close} ms`);
    // The shipped cubic-bezier must track the spring (Clutter progress functions do not work from GJS).
    const bezier = ([x1, y1, x2, y2], x) => {
        let t = x;
        for (let i = 0; i < 12; i++) {
            const dx = 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
            t = Math.min(1, Math.max(0, t - (3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3 - x) / dx));
        }
        return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
    };
    for (const spring of [SPRING_OPEN, SPRING_CLOSE]) {
        const duration = springDuration(spring) / 1000;
        for (let i = 1; i < 50; i++)
            assert.ok(Math.abs(bezier(spring.curve, i / 50) - springAt(i / 50 * duration, spring)) < 0.025, `${spring.response} at ${i}`);
    }
    assert.ok(SPRING_CLOSE.curve[1] <= 1 && SPRING_CLOSE.curve[3] <= 1, 'a shrink never passes its target');
    // Measured in the harness: the first fit overshot 3.7% (16 px on a 492 px card); the curve now caps it.
    const curvePeak = Math.max(...Array.from({length: 101}, (_, i) => bezier(SPRING_OPEN.curve, i / 100)));
    assert.ok(curvePeak > 1.01 && curvePeak <= 1.025, `open curve peak ${curvePeak}`);
});

test('a closing slab stays a rounded drop down to the seed: no square-cornered frames', async () => {
    const {notchGeometry, SLAB_FADE, CLOSE_OUT_MS, CLOSE_IN_MS, SPRING_CLOSE, springDuration} = await import('../extension/dockModel.js');
    // Compact and card shapes are unchanged.
    assert.deepEqual(notchGeometry(36, 292), {ear: 6, radius: 16, sliver: false});
    assert.deepEqual(notchGeometry(146, 492), {ear: 14, radius: 22, sliver: false});
    // v32 drew every height of 10 px or less as a plain rectangle for the last ~90 ms of a close.
    for (let height = 2; height < 36; height++) {
        const {ear, radius, sliver} = notchGeometry(height, 104);
        assert.equal(sliver, false, `${height} px`);
        assert.ok(radius >= 1 && ear >= 1 && ear + radius <= height, `${height} px: ear ${ear} r ${radius}`);
    }
    // v34: the slab fades out through the middle of the retract and the content hand-over splits the
    // spring 55/45, so nothing thinner than ~15 px is ever drawn at full opacity.
    const total = springDuration(SPRING_CLOSE);
    assert.ok(SLAB_FADE.delay >= total * 0.3 && SLAB_FADE.delay + SLAB_FADE.duration <= total * 0.85,
        `slab fade ${SLAB_FADE.delay}+${SLAB_FADE.duration} of ${total}`);
    assert.equal(CLOSE_OUT_MS + CLOSE_IN_MS, total);
    assert.ok(CLOSE_OUT_MS > total / 2 && CLOSE_OUT_MS < total * 0.6, `out ${CLOSE_OUT_MS} of ${total}`);
});
