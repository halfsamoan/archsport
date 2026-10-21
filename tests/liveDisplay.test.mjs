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

test('the live minute advances locally between polls without inventing stoppage time', async () => {
    const {liveMinuteLabel} = await import('../extension/uiModel.js');
    const at = Date.parse('2030-01-01T20:00:00Z');
    const updated = '2030-01-01T20:00:00Z';
    const live = (elapsed, extra = null, status = 'live') => ({status, elapsed, extra});
    const later = minutes => at + minutes * 60000 + 1000;
    assert.equal(liveMinuteLabel(live(61), updated, later(0)), '61′');
    assert.equal(liveMinuteLabel(live(61), updated, later(3)), '64′');
    // Never further than the next poll would have reported.
    assert.equal(liveMinuteLabel(live(61), updated, later(9), 5), '66′');
    assert.equal(liveMinuteLabel(live(61), updated, later(9), 10), '70′');
    // A period's end is a ceiling: its stoppage time is unknown.
    assert.equal(liveMinuteLabel(live(43), updated, later(2)), '45′');
    assert.equal(liveMinuteLabel(live(43), updated, later(4)), '45+′');
    assert.equal(liveMinuteLabel(live(88), updated, later(4)), '90+′');
    assert.equal(liveMinuteLabel(live(90, 2), updated, later(0)), '90+2′');
    assert.equal(liveMinuteLabel(live(90, 2), updated, later(1)), '90+′');
    assert.equal(liveMinuteLabel(live(45), updated, later(2)), '45+′');
    assert.equal(liveMinuteLabel(live(100, null, 'extra_time'), updated, later(7)), '105′');
    assert.equal(liveMinuteLabel(live(100, null, 'extra_time'), updated, later(7), 10), '105+′');
    // A stopped clock stays as reported.
    assert.equal(liveMinuteLabel(live(45, null, 'halftime'), updated, later(6)), '45′');
    assert.equal(liveMinuteLabel(live(120, null, 'penalties'), updated, later(6)), '120′');
    assert.equal(liveMinuteLabel({status: 'finished', elapsed: 90}, updated, later(2)), '');
    assert.equal(liveMinuteLabel(live(null), updated, later(2)), '');
    // Unknown update time: no estimate.
    assert.equal(liveMinuteLabel(live(61), null, later(3)), '61′');
});

test('one minute timer re-renders only while a running clock is shown and dies with the extension', () => {
    assert.match(source, /const minuteCap = Math\.ceil\(\(data\.next_poll_seconds \?\? 300\) \/ 60\);/);
    assert.match(source, /data\.health === 'error' \? liveMinuteLabel\(fixture, null, 0, 0, spoiler\) :\n\s+liveMinuteLabel\(fixture, data\.updated_at, Date\.now\(\), minuteCap, spoiler\);/);
    const tick = source.slice(source.indexOf('// One tick at each minute boundary'), source.indexOf('    _startWorker()'));
    assert.match(tick, /if \(this\._minuteTimer\) GLib\.source_remove\(this\._minuteTimer\);\n\s+this\._minuteTimer = 0;/);
    assert.match(tick, /this\._dock\.state\.visible && data\.health !== 'error'/);
    assert.match(tick, /\['live', 'extra_time'\]\.includes\(match\?\.status\)/);
    const disable = source.slice(source.indexOf('    disable() {'));
    assert.match(disable, /if \(this\._minuteTimer\) GLib\.source_remove\(this\._minuteTimer\);/);
    assert.match(source, /\['_timer', '_pendingAlertTimer', '_closingTimer', '_minuteTimer'\]/);
});

test('a failing live feed explains itself in the open notch', () => {
    // Offline with a kept snapshot goes through health 'error'; otherwise the notice gets its own row.
    assert.match(source, /data\.context\?\.live_available === false && data\.context\.live_notice\)\n\s+expandedBody\.add_child\(this\._statusRow\(\{message: data\.context\.live_notice\}, '라이브 점수 없이 일정만 표시합니다'\)\);/);
    assert.match(source, /_statusRow\(data, detail = null\) \{/);
    // Budget and quota messages lead to settings, never to a reconnect that spends a refused request.
    assert.match(source, /\/키\|예산\|할당량\|설정\|요금제\|시즌\/\.test\(reason\)/);
});

test('a scorer is named only from an event list that accounts for every goal', async () => {
    const {latestEvent, alertAnnouncement} = await import('../extension/uiModel.js');
    const goal = (elapsed, player) => ({kind: 'Goal', detail: 'Normal Goal', elapsed, player, team: 'Barcelona'});
    const card = {kind: 'Card', detail: 'Yellow Card', elapsed: 70, player: 'Booked'};
    const match = {home: 'Barcelona', away: 'Sevilla', home_score: 1, away_score: 0, events: [goal(61, 'First'), card]};
    assert.equal(latestEvent(match).player, 'Booked');
    assert.equal(latestEvent(match, true).player, 'First');
    // A second goal the list does not know yet: no line rather than the previous scorer.
    const behind = {...match, home_score: 2};
    assert.equal(latestEvent(behind, true), null);
    assert.equal(latestEvent(behind), null);
    assert.doesNotMatch(alertAnnouncement({kind: 'score', title: '스코어 변경'}, behind), /First/);
    // Missed penalties never count as a goal.
    assert.equal(latestEvent({...match, events: [goal(61, 'First'), {kind: 'Goal', detail: 'Missed Penalty', player: 'Miss'}]}, true).player, 'First');
    assert.equal(latestEvent({home_score: 0, away_score: 0, events: [card]}).player, 'Booked');
});

test('settings say that cup ties are outside the free schedule', () => {
    const prefs = readFileSync(new URL('../extension/prefs.js', import.meta.url), 'utf8');
    assert.match(prefs, /컵 대회\(코파 델 레이·코파 이탈리아 등\)는 무료 일정에 없어 표시되지 않을 수 있습니다/);
});

test('turning the automatic notch off never makes the shortcut or menu dead', () => {
    assert.match(source, /const allowed = !this\._sleeping && \(this\._expanded \|\|\n\s+this\._settings\.get_boolean\('show-notch'\) && \(active \|\| Boolean\(this\._activeAlert\)\)\);/);
    const prefs = readFileSync(new URL('../extension/prefs.js', import.meta.url), 'utf8');
    assert.match(prefs, /\['show-notch', '경기 중 자동 표시'/);
});

test('spoiler mode hides scores and the extra time that would reveal a draw', async () => {
    const {liveMinuteLabel} = await import('../extension/uiModel.js');
    const updated = '2030-01-01T20:00:00Z';
    const at = Date.parse(updated) + 61000;
    assert.equal(liveMinuteLabel({status: 'extra_time', elapsed: 105}, updated, at, 5, true), '90+′');
    assert.equal(liveMinuteLabel({status: 'penalties', elapsed: 120}, updated, at, 5, true), '90+′');
    assert.equal(liveMinuteLabel({status: 'live', elapsed: 61}, updated, at, 5, true), '62′');
    assert.match(source, /spoiler && \['extra_time', 'penalties'\]\.includes\(match\?\.status\) \? 'live' : match\?\.status/);
    assert.doesNotMatch(source, /● : ●/);
});

test('reminder, empty header and scheduled clock use the schedule rows wording', () => {
    assert.match(source, /shown\.watchedName \? `\$\{shown\.watchedName\} vs \$\{shown\.primary\}`/);
    assert.match(source, /clock = fixtureDate\(new Date\(match\.kickoff_utc\), new Date\(\), false\);/);
    assert.doesNotMatch(source, /toLocaleString\('ko-KR', \{month: 'numeric'/);
    assert.match(source, /clock \? \[competition, clock\]\.filter\(Boolean\)\.join\(' · '\) : '일정'\)/);
});

test('other live rows, the scorer and status alerts reach keyboard and screen-reader users', async () => {
    const {alertAnnouncement} = await import('../extension/uiModel.js');
    const {fixturePresentation} = await import('../extension/fixturePresentation.js');
    assert.match(source, /'archsport-fixture-row', can_focus: true,\n\s+reactive: true, accessible_name: `홈 \$\{fixture\.home\} 대 원정/);
    assert.match(source, /`live:\$\{fixture\.id\}`\);/);
    assert.match(source, /\$\{clock\}\$\{spokenEvent\}`\}\), 'scoreboard'\);/);
    assert.match(source, /\['score', 'correction', 'status', 'kickoff'\]\.includes\(alert\?\.kind\)/);
    assert.match(source, /'펼쳐서 스코어보드 보기' : '펼쳐서 일정과 최근 경기 보기'/);
    const match = {home: 'Barcelona', away: 'Como', home_score: 1, away_score: 0,
        events: [{kind: 'Goal', detail: 'Normal Goal', elapsed: 30, player: 'Scorer'}]};
    assert.equal(alertAnnouncement({kind: 'status', title: '하프타임'}, match), '하프타임. Barcelona 1 대 0 Como');
    const pending = fixturePresentation({home: 'SS Lazio', away: 'Como 1907', team_keys: ['lazio', 'como'],
        result_pending: true}, ['Lazio', 'Como'], {result: true});
    assert.match(pending.accessibleName, /결과 확인 중$/);
    assert.doesNotMatch(pending.accessibleName, /미확인 대/);
});
