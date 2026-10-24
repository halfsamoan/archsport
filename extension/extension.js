import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Pango from 'gi://Pango';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {DockParticipant, easeOnCurve, closeEase, afterDispatch} from './notchDock.js';
import {isActorWithin, CLOSE_OUT_MS, CLOSE_IN_MS, CONTENT_SHRINK_TO, CONTENT_GROW_FROM} from './dockModel.js';
import {DESIGN} from './designTokens.js';
import {calculateExpandedViewport, scoreDirection, eventSummary, alertAnnouncement, latestEvent,
    liveMinuteLabel} from './uiModel.js';
import {competitionLabel, displayTeam, fixtureDate, fixturePresentation, teamCode} from './fixturePresentation.js';
import {enqueuePendingAlert, expirePendingAlerts, restorePendingAlerts, takePendingAlert} from './alertQueue.js';

const DATA_KEYS = new Set(['mode', 'team-name', 'team-country', 'watch-teams', 'poll-seconds', 'daily-budget', 'key-revision']);
const STATUS = {live: '진행 중', halftime: 'HT', finished: '경기 종료', scheduled: '경기 전',
    extra_time: '연장', penalties: '승부차기', postponed: '연기', cancelled: '취소',
    interrupted: '중단', abandoned: '중단 종료', unknown: '상태 미확인'};
const firstFocusable = actor => {
    for (const child of actor.get_children()) {
        if (child.can_focus && child.reactive) return child;
        const nested = firstFocusable(child);
        if (nested) return nested;
    }
    return null;
};
// Rebuilt widgets carry a stable _focusKey so a rerender returns focus to the same control.
const findFocusKey = (actor, key) => {
    if (!key) return null;
    for (const child of actor.get_children()) {
        if (child._focusKey === key && child.can_focus && child.reactive) return child;
        const nested = findFocusKey(child, key);
        if (nested) return nested;
    }
    return null;
};
const focusKey = (actor, key) => {
    actor._focusKey = key;
    return actor;
};

export default class Archsport extends Extension {
    enable() {
        this._enabled = true;
        this._shellEnding = false;
        this._clearPendingRelogin();
        // Monotonic across disable/enable so same-tick re-enable still marks old reads stale.
        this._generation = (this._generation ?? 0) + 1;
        this._signals = [];
        this._timer = this._restartTimer = this._pendingAlertTimer = this._closingTimer = 0;
        this._announcementTimer = this._minuteTimer = 0;
        this._announcedAlertKeys ??= new Set();
        this._lastAnnouncementAt ??= null;
        this._queuedAnnouncement = null;
        this._failures = 0;
        this._expanded = false;
        this._returnWindow = null;
        this._showContext = false;
        this._renderedExpanded = false;
        this._sleeping = false;
        this._activeAlert = null;
        this._alertAnimate = false;
        this._scoreFeedback = null;
        this._pendingAlerts = [];
        this._pendingAlertRecord = this._readPendingAlertRecord();
        this._alertDeadline = 0;
        this._payload = {mode: 'live', health: 'loading', visible: false, message: '경기 정보 연결 중'};
        this._settings = this.getSettings();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        // The root stays non-reactive so the transparent ears pass clicks through, and so it
        // must not take focus: St marks it :insensitive and key events skip it (Tab and Esc died
        // there). Focus goes to real controls; Esc is caught at the stage below.
        this._root = new St.BoxLayout({vertical: true, style_class: 'archsport-notch',
            reactive: false, can_focus: false,
            accessible_name: 'Archsport 경기 노치', clip_to_allocation: true});
        // St.FocusManager uses this group to include notch controls in keyboard traversal.
        global.focus_manager.add_group(this._root);
        const openDashboard = () => {
            if (!this._dock.claim(100)) return;
            this._returnWindow = global.display.get_focus_window();
            this._expanded = true;
            this._activeAlert = null;
            this._alertAnimate = false;
            this._render();
            if (this._dock.state.visible) this._focusPrimary();
        };
        const staleIndicator = Main.panel.statusArea[this.uuid];
        if (staleIndicator) {
            Main.panel.statusArea[this.uuid] = null;
            staleIndicator.destroy();
        }
        this._indicator = new PanelMenu.Button(0.0, 'Archsport');
        // Own symbolic mark (pitch + ball): the stock calendar icon read as the clock's neighbour.
        this._indicator.add_child(new St.Icon({style_class: 'system-status-icon',
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this.path, 'icons', 'archsport-symbolic.svg'])),
            y_align: Clutter.ActorAlign.CENTER, accessible_name: '경기 정보'}));
        // The global shortcut is otherwise invisible; the menu names it next to the action.
        const shortcut = this._settings.get_strv('archsport-toggle-shortcut')[0] ?? '';
        const shortcutHint = shortcut.startsWith('KP_') ? `숫자패드 ${shortcut.slice(3)}` : shortcut;
        this._indicator.menu.addAction(shortcutHint ? `노치 펼치기 / 접기 · ${shortcutHint}` : '노치 펼치기 / 접기',
            () => this._toggle());
        this._indicator.menu.addAction('일정 · 최근 경기', openDashboard);
        this._indicator.menu.addAction('Archsport 설정', () => this._openPreferences());
        this._indicator.menu.addAction('데이터 다시 연결', () => this._restartWorker());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._dock = new DockParticipant({id: this.uuid, content: this._root,
            monitor: () => this._monitor(), triggerActor: () => this._indicator, order: 0,
            onOutside: () => this._toggle(), onShellShutdown: () => this._beginShellShutdown(),
            onYield: () => {
                if (this._activeAlert) enqueuePendingAlert(this._pendingAlerts, this._activeAlert);
                this._persistPendingAlerts();
                this._expanded = false; this._activeAlert = null; this._alertAnimate = false;
                if (this._timer) GLib.source_remove(this._timer);
                this._timer = 0;
                this._render(); this._schedulePendingAlert();
            }});
        // Global shortcut (numpad Enter by default). The Shell grab keeps the key from apps.
        Main.wm.addKeybinding('archsport-toggle-shortcut', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL, () => this._toggle());
        this._connect(global.stage, 'key-press-event', (_stage, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape ||
                !isActorWithin(global.stage.get_key_focus(), this._root)) return Clutter.EVENT_PROPAGATE;
            this._closeAfterDispatch();
            return Clutter.EVENT_STOP;
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => this._visibility());
        this._connect(Main.panel, 'destroy', () => this._beginShellShutdown());
        this._connect(this._root, 'destroy', () => this._beginShellShutdown());
        this._connect(this._indicator, 'destroy', () => this._beginShellShutdown());
        this._connect(Main.panel, 'notify::height', () => this._visibility());
        this._connect(Main.overview, 'showing', () => this._onOverviewShowing());
        this._connect(Main.overview, 'hidden', () => this._visibility());
        this._connect(Main.sessionMode, 'updated', () => this._visibility());
        this._connect(global.display, 'in-fullscreen-changed', () => this._onFullscreenChanged());
        this._connect(this._settings, 'changed', (_settings, key) => {
            if (DATA_KEYS.has(key)) this._restartWorker();
            else {
                if (this._settings.get_boolean('spoiler') || !this._settings.get_boolean('expand-on-event') ||
                    !this._settings.get_boolean('show-notch'))
                    this._pendingAlerts = [];
                if (this._settings.get_boolean('spoiler')) {
                    if (this._announcementTimer) GLib.source_remove(this._announcementTimer);
                    this._announcementTimer = 0;
                    this._queuedAnnouncement = null;
                }
                this._persistPendingAlerts();
                this._activeAlert = null;
                this._alertAnimate = false;
                this._render();
                this._showPendingAlert();
            }
        });
        this._connect(this._interface, 'changed::color-scheme', () => this._render());
        this._connect(this._interface, 'changed::gtk-theme', () => this._render());
        this._sleepSubscription = Gio.DBus.system.signal_subscribe('org.freedesktop.login1',
            'org.freedesktop.login1.Manager', 'PrepareForSleep', '/org/freedesktop/login1',
            null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, args) => {
                if (args.deep_unpack()[0]) { this._sleeping = true; this._stopWorker(); this._visibility(); }
                else if (this._enabled) { this._sleeping = false; this._restartWorker(); this._visibility(); }
            });
        this._render();
        this._startWorker();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _openPreferences() {
        try {
            Promise.resolve(this.openPreferences()).catch(error =>
                console.warn(`[Archsport] 설정을 열지 못했습니다: ${error.message}`));
        } catch (error) {
            console.warn(`[Archsport] 설정을 열지 못했습니다: ${error.message}`);
        }
    }

    _beginShellShutdown() {
        if (this._shellEnding) return;
        this._shellEnding = true;
        this._enabled = false;
        this._sleeping = true;
        this._dock?.dock?.shutdown();
        this._stopWorker();
        for (const name of ['_timer', '_pendingAlertTimer', '_closingTimer', '_minuteTimer']) {
            if (this[name]) GLib.source_remove(this[name]);
            this[name] = 0;
        }
        if (this._sleepSubscription) Gio.DBus.system.signal_unsubscribe(this._sleepSubscription);
        this._sleepSubscription = 0;
    }

    _clearPendingRelogin() {
        const path = GLib.build_filenamev([GLib.get_user_state_dir(), 'archsport', 'pending-relogin.json']);
        try {
            const [, contents] = Gio.File.new_for_path(path).load_contents(null);
            const marker = JSON.parse(new TextDecoder().decode(contents));
            if (Number(marker.installed) === Number(this.metadata.version))
                Gio.File.new_for_path(path).delete(null);
        } catch (_error) {
            // Keep unmatched or unreadable markers for the next diagnostic run.
        }
    }

    // Esc and the collapse button arrive inside Clutter's event dispatch; the close itself runs right
    // after it, like the global shortcut's (see notchDock.afterDispatch).
    _closeAfterDispatch() {
        afterDispatch(this._dock.dock, () => {
            if (!this._enabled) return;
            this._expanded = false; this._activeAlert = null; this._alertAnimate = false; this._render();
        });
    }

    _toggle() {
        const expanding = !this._expanded && !this._activeAlert;
        if (expanding && !this._dock.claim(100)) return;
        if (expanding) this._returnWindow = global.display.get_focus_window();
        this._expanded = expanding;
        this._activeAlert = null;
        this._alertAnimate = false;
        this._render();
        if (expanding && this._dock.state.visible) this._focusPrimary();
    }

    // Opening lands on the header anchor: a screen reader announces the match or schedule
    // summary first, and the next Tab reaches the first fixture or scoreboard.
    _focusPrimary() {
        (this._primaryFocus?.get_parent() ? this._primaryFocus : firstFocusable(this._root))?.grab_key_focus();
    }

    _releaseFocus() {
        const focus = global.stage.get_key_focus();
        if (!isActorWithin(focus, this._root) && focus !== this._indicator) return;
        global.stage.set_key_focus(null);
        const win = this._returnWindow;
        this._returnWindow = null;
        if (win && !win.minimized && win.get_workspace?.() === global.workspace_manager.get_active_workspace())
            win.focus(global.get_current_time());
    }

    _monitor() {
        const index = this._settings.get_int('monitor-index');
        return Main.layoutManager.monitors[index] ?? Main.layoutManager.primaryMonitor;
    }

    _recentlyUpdated() {
        const updated = Date.parse(this._payload.updated_at ?? '');
        const staleAfterMs = (this._payload.stale_after_seconds ?? 300) * 1000;
        return Number.isFinite(updated) && Date.now() - updated >= -30000 && Date.now() - updated <= staleAfterMs;
    }

    _visibility() {
        if (!this._enabled || this._shellEnding || !this._dock) return;
        const match = this._payload.match;
        // A finished match arrives as visible only during the worker's short final-score window.
        const active = this._payload.visible !== false && this._recentlyUpdated() &&
            (this._payload.mode === 'demo' && Boolean(match) ||
                ['live', 'halftime', 'extra_time', 'penalties', 'interrupted', 'finished'].includes(match?.status));
        // The switch stops only the automatic notch; a dashboard the user opened always shows.
        const allowed = !this._sleeping && (this._expanded ||
            this._settings.get_boolean('show-notch') && (active || Boolean(this._activeAlert)));
        const fullscreen = this._settings.get_boolean('hide-fullscreen') && this._monitor()?.inFullscreen;
        const monitor = this._monitor();
        const expanded = this._expanded || Boolean(this._activeAlert);
        const width = Math.min(expanded ? (this._showContext || !match ? DESIGN.geometry.archContext :
            DESIGN.geometry.archExpanded) : DESIGN.geometry.archCompact,
            Math.max(1, (monitor?.width ?? 800) - 24));
        const height = expanded ? (this._contentHeight ?? (this._activeAlert ? 160 : 180)) :
            this._compactHeight ?? DESIGN.control.compactHeight;
        let visible = allowed && !Main.overview.visible && !Main.sessionMode.isLocked && !fullscreen;
        if (visible && (this._expanded || this._activeAlert) && this._dock.dock.active?.id !== this.uuid)
            visible = this._dock.claim(this._expanded ? 100 : 80);
        this._indicator.visible = true;
        this._dock.update({width, height, visible, expanded});
        if (visible && this._activeAlert) this._announceAlert(this._activeAlert);
    }

    _onOverviewShowing() {
        if (this._expanded && !this._activeAlert) {
            this._expanded = false;
            this._render();
        } else {
            this._visibility();
        }
    }

    _onFullscreenChanged() {
        if (this._settings.get_boolean('hide-fullscreen') && this._monitor()?.inFullscreen &&
            this._expanded && !this._activeAlert) {
            this._expanded = false;
            this._render();
        } else {
            this._visibility();
        }
    }

    _label(text, style) {
        const label = new St.Label({text: String(text), style_class: style, x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }

    _iconButton(iconName, accessibleName, action) {
        const button = new St.Button({style_class: 'archsport-icon-button', can_focus: true,
            accessible_name: accessibleName,
            child: new St.Icon({icon_name: iconName, icon_size: DESIGN.control.icon})});
        button.connect('clicked', action);
        return button;
    }

    _logo(match, side, size) {
        const path = match?.[`${side}_logo_path`] ?? (match?.[`${side}_id`] ?
            GLib.build_filenamev([this.path, 'assets', 'logos', `${match[`${side}_id`]}.png`]) : null);
        if (path && GLib.file_test(path, GLib.FileTest.IS_REGULAR))
            return new St.Icon({gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}), icon_size: size,
                accessible_name: match[side], y_align: Clutter.ActorAlign.CENTER});
        // Missing crest is the club's short text code (SEV), never a fabricated emblem; a
        // full name would be cut off in the 200 px pill.
        const label = this._label(teamCode(match, side), 'archsport-team-code');
        label.accessible_name = match?.[side] ?? '';
        return label;
    }

    _crestIcon(match, side, size) {
        const path = match?.[`${side}_logo_path`] ?? (match?.[`${side}_id`] ?
            GLib.build_filenamev([this.path, 'assets', 'logos', `${match[`${side}_id`]}.png`]) : null);
        if (!path || !GLib.file_test(path, GLib.FileTest.IS_REGULAR)) return null;
        return new St.Icon({gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
            icon_size: size, accessible_name: match[side], y_align: Clutter.ActorAlign.CENTER});
    }

    _watchedCrestIcon(match, size) {
        if (!match) return null;
        const normalize = value => String(value ?? '').toLowerCase().replace(/\bfc\b/g, '').replace(/[^a-z0-9]/g, '');
        const watched = new Set(this._settings.get_strv('watch-teams').map(normalize));
        for (const [side, index] of [['home', 0], ['away', 1]]) {
            if (!watched.has(normalize(match[side])) && !watched.has(normalize(match.team_keys?.[index]))) continue;
            const path = match[`${side}_logo_path`] ?? (match[`${side}_id`] ?
                GLib.build_filenamev([this.path, 'assets', 'logos', `${match[`${side}_id`]}.png`]) : null);
            if (path && GLib.file_test(path, GLib.FileTest.IS_REGULAR))
                return new St.Icon({gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
                    icon_size: size, accessible_name: match[side], y_align: Clutter.ActorAlign.CENTER});
        }
        return null;
    }

    // Offline explains itself: what failed, how old the shown data is (or the given detail),
    // and the one action that can fix it (settings for a key or budget problem, otherwise reconnect).
    _statusRow(data, detail = null) {
        const row = new St.BoxLayout({style_class: 'archsport-status-row'});
        row.add_child(new St.Icon({icon_name: 'dialog-warning-symbolic', icon_size: 14,
            style_class: 'archsport-status-icon', y_align: Clutter.ActorAlign.START}));
        const text = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'archsport-status-text'});
        const mismatch = Boolean(data.ui_version_mismatch);
        const reason = mismatch ? '새 버전이 설치되었습니다. 다시 로그인하면 적용됩니다.' :
            data.message || '경기 서비스에 연결할 수 없습니다.';
        const reasonLabel = this._label(reason, 'archsport-status-message');
        reasonLabel.clutter_text.set_line_wrap(true);
        reasonLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        text.add_child(reasonLabel);
        const updated = Date.parse(data.updated_at ?? '');
        if (detail) {
            text.add_child(this._label(detail, 'archsport-date'));
        } else if (!mismatch) {
            text.add_child(this._label(Number.isFinite(updated) ?
                `마지막 갱신 ${new Date(updated).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', hour12: false})} · 아래는 그때 정보` :
                '아직 받은 정보 없음', 'archsport-date'));
        }
        row.add_child(text);
        if (!mismatch) {
            // A spent quota only waits for its reset; reconnecting would just spend a refused request.
            const settingsFix = /키|예산|할당량|설정|요금제|시즌/.test(reason);
            const action = new St.Button({label: settingsFix ? '설정 열기' : '다시 연결',
                style_class: 'archsport-pill-button', can_focus: true, y_align: Clutter.ActorAlign.START});
            focusKey(action, 'status-action');
            action.connect('clicked', () => settingsFix ? this._openPreferences() : this._restartWorker(0));
            row.add_child(action);
        }
        row.accessible_name = reason;
        return row;
    }

    // Real crest, or a neutral circle with the club's initials when no crest is installed.
    _teamMark(match, side, size) {
        const crest = this._crestIcon(match, side, size);
        if (crest) return crest;
        const code = new St.Label({text: teamCode(match, side), style_class: 'archsport-monogram-text',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        code.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        // Minimum size only: Large Text widens the ring into a pill rather than cutting 'SEV'.
        return new St.Bin({style_class: 'archsport-monogram', style: `min-width: ${size}px; min-height: ${size}px;`,
            accessible_name: match?.[side] ?? '', child: code});
    }

    // Fixed-width lead so every opponent name starts on one line: the watched team's real
    // crest (both crests when two watched clubs meet), or its short name without a crest.
    _fixtureLead(fixture, presentation) {
        const lead = new St.BoxLayout({style_class: 'archsport-fixture-lead'});
        const sides = presentation.crestSide ? [presentation.crestSide] :
            presentation.watchedBoth ? ['home', 'away'] : [];
        for (const side of sides) {
            const mark = this._crestIcon(fixture, side, 16) ??
                this._label(displayTeam(fixture, side), 'archsport-watch-name');
            lead.add_child(mark);
        }
        return lead;
    }

    // One schedule/result line: lead, opponent with 홈/원정 beside it, then 승/무/패 and the
    // watched club's score first (results), and the date.
    _fixtureRow(fixture, {result = false, spoiler = false} = {}) {
        const presentation = fixturePresentation(fixture, this._settings.get_strv('watch-teams'),
            {result, spoiler});
        const row = focusKey(new St.BoxLayout({style_class: 'archsport-fixture-row', can_focus: true, reactive: true,
            accessible_name: presentation.accessibleName}), `fixture:${fixture?.id ?? presentation.accessibleName}`);
        row.add_child(this._fixtureLead(fixture, presentation));
        const names = new St.BoxLayout({style_class: 'archsport-fixture-names', x_expand: true});
        names.add_child(this._label(presentation.primary, 'archsport-context-text'));
        // '홈 · UCL': which competition, in the same quiet caption as home/away.
        const tertiary = [presentation.direction, presentation.competition].filter(Boolean).join(' · ');
        if (tertiary) names.add_child(this._label(tertiary, 'archsport-direction'));
        row.add_child(names);
        if (result && fixture?.result_pending) {
            row.add_child(this._label('결과 대기', 'archsport-date'));
        } else if (result && spoiler) {
            row.add_child(this._label('결과 숨김', 'archsport-date'));
        } else if (result) {
            if (presentation.outcomeKind) {
                row.add_child(new St.Label({text: presentation.outcome, y_align: Clutter.ActorAlign.CENTER,
                    style_class: `archsport-outcome archsport-outcome-${presentation.outcomeKind}`}));
            }
            row.add_child(this._label(presentation.score, 'archsport-result-score'));
        }
        row.add_child(this._label(presentation.shortDate, result ? 'archsport-date archsport-date-result' : 'archsport-date'));
        return row;
    }

    _schedulePendingAlert() {
        if (!this._enabled || !this._pendingAlerts.length || this._pendingAlertTimer) return;
        this._pendingAlertTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._pendingAlertTimer = 0;
            this._showPendingAlert();
            return GLib.SOURCE_REMOVE;
        });
    }

    _pendingAlertsPath() {
        return GLib.build_filenamev([GLib.get_user_state_dir(), 'archsport', 'pending-alerts.json']);
    }

    _readPendingAlertRecord() {
        try {
            const file = Gio.File.new_for_path(this._pendingAlertsPath());
            const [, bytes] = file.load_contents(null);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (_error) {
            return null;
        }
    }

    _persistPendingAlerts() {
        const path = this._pendingAlertsPath();
        const file = Gio.File.new_for_path(path);
        try {
            if (!this._pendingAlerts.length) {
                try { file.delete(null); } catch (_error) { /* already absent */ }
                return;
            }
            GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
            const contents = JSON.stringify({alerts: this._pendingAlerts, saved_at: Date.now()});
            file.replace_contents(new TextEncoder().encode(contents), null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
        } catch (_error) {
            // Persistence is best-effort; live presentation must keep working.
        }
    }

    _showPendingAlert() {
        if (!this._enabled) return;
        if (expirePendingAlerts(this._pendingAlerts)) this._persistPendingAlerts();
        if (!this._pendingAlerts.length || this._activeAlert) return;
        if (this._settings.get_boolean('spoiler') || !this._settings.get_boolean('expand-on-event') ||
            !this._settings.get_boolean('show-notch')) {
            this._pendingAlerts = [];
            this._persistPendingAlerts();
            return;
        }
        const monitor = this._monitor();
        if (Main.overview.visible || Main.sessionMode.isLocked ||
            (this._settings.get_boolean('hide-fullscreen') && monitor?.inFullscreen)) {
            this._schedulePendingAlert();
            return;
        }
        const queued = this._pendingAlerts.length;
        const alert = takePendingAlert(this._pendingAlerts, () => this._dock.claim(this._expanded ? 100 : 80));
        // A blocked claim retries every 2 s; rewrite the file only when the queue changed.
        if (this._pendingAlerts.length !== queued) this._persistPendingAlerts();
        if (!alert) {
            this._schedulePendingAlert();
            return;
        }
        if (this._expanded && alert.kind === 'score') {
            this._scoreFeedback = alert;
            this._render();
            this._announceAlert(alert);
            this._schedulePendingAlert();
            return;
        }
        this._activeAlert = alert;
        this._alertAnimate = true;
        this._alertDeadline = GLib.get_monotonic_time() / 1000 + this._settings.get_int('event-seconds') * 1000;
        this._render();
        this._announceAlert(alert);
    }

    _alertKey(alert) {
        return alert?.id ?? alert?.fingerprint ??
            (alert?.kind === 'kickoff' && alert.match_id && alert.kickoff_utc ?
                `${alert.match_id}:${alert.kickoff_utc}:${alert.title ?? ''}` : null);
    }

    _alertVisible(alert, key) {
        if (!this._dock?.state.visible || Main.overview.visible || Main.sessionMode.isLocked ||
            (this._settings.get_boolean('hide-fullscreen') && this._monitor()?.inFullscreen)) return false;
        if (this._alertKey(this._activeAlert) === key) return true;
        return alert.kind === 'score' && this._expanded &&
            String(this._payload.match?.id) === String(alert.match_id);
    }

    _announceAlert(alert) {
        if (!['score', 'correction', 'status', 'kickoff'].includes(alert?.kind)) return;
        const key = this._alertKey(alert);
        if (!key || this._announcedAlertKeys.has(key) || !this._alertVisible(alert, key)) return;
        const now = GLib.get_monotonic_time() / 1000;
        const wait = this._lastAnnouncementAt === null ? 0 : 10000 - (now - this._lastAnnouncementAt);
        if (wait > 0) {
            this._queuedAnnouncement = alert;
            if (!this._announcementTimer) {
                this._announcementTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(wait), () => {
                    this._announcementTimer = 0;
                    const pending = this._queuedAnnouncement;
                    this._queuedAnnouncement = null;
                    if (pending) this._announceAlert(pending);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        const text = alertAnnouncement(alert, this._payload.match, this._settings.get_boolean('spoiler'));
        try { this._root.get_accessible()?.emit('notification', text, Atk.Live.POLITE); }
        catch (_error) { /* ATK notification support varies across Shell and Orca versions. */ }
        this._announcedAlertKeys.add(key);
        if (this._announcedAlertKeys.size > 256)
            this._announcedAlertKeys.delete(this._announcedAlertKeys.values().next().value);
        this._lastAnnouncementAt = now;
    }

    _render(afterCollapse = false) {
        if (!this._enabled || this._shellEnding) return;
        const focusWasInside = isActorWithin(global.stage.get_key_focus(), this._root);
        const focusedKey = focusWasInside ? global.stage.get_key_focus()?._focusKey : null;
        this._primaryFocus = null;
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const now = GLib.get_monotonic_time() / 1000;
        const spoiler = this._settings.get_boolean('spoiler');
        if (spoiler || !this._settings.get_boolean('expand-on-event')) {
            this._activeAlert = null;
            this._alertAnimate = false;
        } else if (this._activeAlert && now >= this._alertDeadline) {
            this._activeAlert = null;
            this._alertAnimate = false;
        }
        const alert = this._activeAlert;
        const localScoreFeedback = this._scoreFeedback;
        const incoming = localScoreFeedback ?? (this._alertAnimate ? alert : null);
        this._scoreFeedback = null;
        this._alertAnimate = false;
        const data = this._payload;
        const match = data.match;
        // Spoiler mode prints words, not two dots that read like a rendering glitch.
        const score = spoiler ? '숨김' : match ? `${match.home_score ?? '–'} : ${match.away_score ?? '–'}` : '– : –';
        const spokenScore = spoiler ? '점수 숨김' : match ? `${match.home_score ?? '미확인'} 대 ${match.away_score ?? '미확인'}` : '';
        // Offline data stays as last reported; the status row says how old it is.
        const minuteCap = Math.ceil((data.next_poll_seconds ?? 300) / 60);
        const minuteOf = fixture => data.health === 'error' ? liveMinuteLabel(fixture, null, 0, 0, spoiler) :
            liveMinuteLabel(fixture, data.updated_at, Date.now(), minuteCap, spoiler);
        const liveMinute = minuteOf(match);
        // Spoiler mode: extra time or a shoot-out would reveal a draw, so both read as 진행 중.
        const shownStatus = spoiler && ['extra_time', 'penalties'].includes(match?.status) ? 'live' : match?.status;
        let clock = match ? `${STATUS[shownStatus] ?? '상태 미확인'} ${liveMinute}`.trim() : '';
        if (match?.status === 'scheduled' && match.kickoff_utc) {
            // Same 24-hour '오늘 04:00' / '10.24(토) 03:45' as the schedule rows.
            clock = fixtureDate(new Date(match.kickoff_utc), new Date(), false);
        }
        // Green marks only a match that is being played right now, on data that is not stale.
        const liveNow = data.mode !== 'demo' && data.health !== 'error' && this._recentlyUpdated() &&
            ['live', 'extra_time', 'penalties'].includes(match?.status);
        const expanded = this._expanded || Boolean(alert);
        if (this._closingTimer) {
            if (!expanded) { this._visibility(); return; }
            GLib.source_remove(this._closingTimer);
            this._closingTimer = 0;
            this._renderedExpanded = false;
        }
        const opening = expanded && !this._renderedExpanded;
        const closing = !expanded && this._renderedExpanded;
        if (closing) this._releaseFocus();
        if (closing && !afterCollapse && this._interface.get_boolean('enable-animations')) {
            // The expanded content stays for the reverse morph; its controls stop taking input at once.
            const children = this._root.get_children();
            for (const child of children) {
                const descendants = [child];
                while (descendants.length) {
                    const actor = descendants.pop();
                    actor.reactive = false;
                    actor.can_focus = false;
                    descendants.push(...actor.get_children());
                }
            }
            this._visibility();
            // Down to the compact row: the card fades and shrinks towards the panel edge over the first
            // part of the retract while the slab clips it; the row then grows in (CLOSE_IN_MS). A slab
            // retracting out of sight fades the whole content itself (notchDock.placeContent).
            if (this._dock.state.visible) {
                for (const child of children) {
                    child.set_pivot_point(0.5, 0);
                    closeEase(child, {opacity: 0, scale_x: CONTENT_SHRINK_TO, scale_y: CONTENT_SHRINK_TO});
                }
            }
            this._closingTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLOSE_OUT_MS, () => {
                this._closingTimer = 0;
                this._render(true);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        for (const child of this._root.get_children()) child.destroy();
        let expandedHeader = null;
        let expandedBody = null;
        let expandedScroll = null;
        // [actor, from, to] entrances; started only after the slab shows the tree.
        const entrances = [];
        const flashes = [];
        if (!expanded) {
            this._root.remove_style_class_name('archsport-open');
            const row = new St.BoxLayout({style_class: 'archsport-compact',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            if (match) row.add_child(this._logo(match, 'home', 20));
            row.add_child(this._label(score, spoiler ? 'archsport-team archsport-team-hidden' : 'archsport-team'));
            if (match) row.add_child(this._logo(match, 'away', 20));
            const compactStatus = data.mode === 'demo' ? '시연' : data.health === 'error' ? '오프라인' :
                match?.status === 'halftime' ? 'HT' : match?.status === 'finished' ? '종료' :
                    match?.status === 'scheduled' ? '예정' : liveMinute;
            if (compactStatus)
                row.add_child(this._label(compactStatus, data.health === 'error' ? 'archsport-alert' :
                    liveNow ? 'archsport-caption archsport-live-now' : 'archsport-caption'));
            const compact = new St.Button({style_class: 'archsport-compact-button', can_focus: true, x_expand: true,
                accessible_name: `${match ? `홈 ${match.home} 원정 ${match.away}, ${spokenScore}` : '축구'}, ${clock || '경기 정보'}. ` +
                    (match && match.status !== 'scheduled' ? '펼쳐서 스코어보드 보기' : '펼쳐서 일정과 최근 경기 보기')});
            compact.set_child(row);
            compact.connect('clicked', () => this._toggle());
            this._root.add_child(compact);
        } else {
            this._root.add_style_class_name('archsport-open');
            const header = new St.BoxLayout({style_class: 'archsport-header'});
            // Focus anchor on open: it receives keys (Tab, Esc) and its name is read first, but it
            // draws no ring, so opening with the mouse shows no stray focus box; Tab reveals rings.
            const identity = focusKey(new St.BoxLayout({style_class: 'archsport-identity', x_expand: true,
                reactive: true, can_focus: true}), 'anchor');
            this._primaryFocus = identity;
            // The title row is the island's own surface: a click on it folds the card.
            identity.connect('button-release-event', () => {
                afterDispatch(this._dock.dock, () => this._toggle());
                return Clutter.EVENT_STOP;
            });
            // The scoreboard below already carries both marks; a kickoff reminder without one
            // borrows the watched club's real crest. The schedule view stays text-only.
            const scoreboardShown = Boolean(match) && match.status !== 'scheduled';
            const headerCrest = alert && !scoreboardShown ? this._watchedCrestIcon(match, 18) : null;
            if (headerCrest) identity.add_child(headerCrest);
            const alertTitle = alert?.kind === 'score' ?
                alert.scoring_side === 'watched' ? '골!' : alert.scoring_side === 'opponent' ? '상대 골' : alert.title : alert?.title;
            const competition = data.mode === 'demo' ? '' : competitionLabel(match);
            identity.add_child(this._label(data.mode === 'demo' && alertTitle ? `시연 · ${alertTitle}` :
                alertTitle || (data.mode === 'demo' ? '시연' : data.health === 'error' ?
                    (data.ui_version_mismatch ? '업데이트 적용 대기' : '오프라인') :
                    clock ? [competition, clock].filter(Boolean).join(' · ') : '일정'),
                alert ? 'archsport-event-title' : data.health === 'error' ? 'archsport-alert' :
                    liveNow ? 'archsport-live archsport-live-now' : 'archsport-live'));
            header.add_child(identity);
            const tools = new St.BoxLayout({style_class: 'archsport-tools'});
            tools.add_child(focusKey(this._iconButton('preferences-system-symbolic', '설정', () => this._openPreferences()), 'settings'));
            tools.add_child(focusKey(this._iconButton('pan-up-symbolic', '접기', () => this._closeAfterDispatch()), 'collapse'));
            header.add_child(tools);
            this._root.add_child(header);
            expandedHeader = header;
            expandedBody = new St.BoxLayout({vertical: true, style_class: 'archsport-body'});

            if (data.health === 'error' && data.mode !== 'demo')
                expandedBody.add_child(this._statusRow(data));
            else if (data.mode !== 'demo' && data.context?.live_available === false && data.context.live_notice)
                expandedBody.add_child(this._statusRow({message: data.context.live_notice}, '라이브 점수 없이 일정만 표시합니다'));
            if (alert?.kind === 'kickoff') {
                const reminder = new St.BoxLayout({style_class: 'archsport-context-row'});
                reminder.add_child(new St.Icon({icon_name: 'alarm-symbolic', icon_size: 17}));
                // 'Barcelona vs PSG · 원정 · 오늘 04:00' in the short names the schedule rows use.
                const fixture = [match, ...(data.context?.upcoming_matches ?? [])]
                    .find(item => item && String(item.id) === String(alert.match_id));
                const shown = fixture && fixturePresentation(fixture, this._settings.get_strv('watch-teams'));
                reminder.add_child(this._label(shown ? [shown.watchedName ? `${shown.watchedName} vs ${shown.primary}` :
                    shown.primary, shown.direction, shown.shortDate].filter(Boolean).join(' · ') :
                    `${displayTeam({home: alert.club}, 'home')} vs ${displayTeam({home: alert.opponent}, 'home')}`,
                'archsport-event'));
                expandedBody.add_child(reminder);
            }
            const latest = latestEvent(match, alert?.kind === 'score');
            if (scoreboardShown) {
                // The event line below cannot take focus, so the scoreboard reads it too.
                const spokenEvent = latest && !spoiler ? `, ${eventSummary(latest)}` : '';
                const scoreboard = focusKey(new St.BoxLayout({style_class: 'archsport-scoreboard', x_expand: true,
                    reactive: true, can_focus: true,
                    accessible_name: `${competition ? `${competition}, ` : ''}홈 ${match.home} 대 원정 ${match.away}, ${spokenScore}, ${clock}${spokenEvent}`}), 'scoreboard');
                const home = new St.BoxLayout({style_class: 'archsport-side', vertical: true, x_expand: true});
                const homeLogo = this._teamMark(match, 'home', 34);
                homeLogo.x_align = Clutter.ActorAlign.CENTER;
                home.add_child(homeLogo);
                const homeName = this._label(displayTeam(match, 'home'), 'archsport-team-name');
                homeName.accessible_name = match.home;
                homeName.x_align = Clutter.ActorAlign.CENTER;
                home.add_child(homeName);
                const away = new St.BoxLayout({style_class: 'archsport-side', vertical: true, x_expand: true});
                const awayLogo = this._teamMark(match, 'away', 34);
                awayLogo.x_align = Clutter.ActorAlign.CENTER;
                away.add_child(awayLogo);
                const awayName = this._label(displayTeam(match, 'away'), 'archsport-team-name');
                awayName.accessible_name = match.away;
                awayName.x_align = Clutter.ActorAlign.CENTER;
                away.add_child(awayName);
                scoreboard.add_child(home);
                const scoreLabel = this._label(spoiler ? '점수 숨김' : score, spoiler ? 'archsport-score archsport-score-hidden' : 'archsport-score');
                scoreLabel.accessible_name = spokenScore;
                scoreLabel.y_align = Clutter.ActorAlign.CENTER;
                if (incoming?.kind === 'score') {
                    flashes.push(scoreLabel);
                    // While opening, the body already drops in; a rising score would move against it.
                    if (!opening) {
                        entrances.push([scoreLabel, {opacity: 0, translation_y: 4},
                            {opacity: 255, translation_y: 0, duration: DESIGN.motion.event}]);
                    }
                    for (const crest of [homeLogo, awayLogo].filter(Boolean)) {
                        crest.set_pivot_point(0.5, 0.5);
                        entrances.push([crest, {scale_x: 0.9, scale_y: 0.9}, {scale_x: 1, scale_y: 1,
                            duration: DESIGN.motion.event, delay: opening ? DESIGN.motion.secondaryDelay : 0}]);
                    }
                }
                scoreboard.add_child(scoreLabel);
                scoreboard.add_child(away);
                expandedBody.add_child(scoreboard);
            }
            if (latest && !spoiler) {
                const eventLabel = this._label(eventSummary(latest), 'archsport-event');
                // While the notch is opening the whole body already settles in; a second
                // entrance on this line would move against it.
                if (incoming && !localScoreFeedback && !opening) {
                    entrances.push([eventLabel, {opacity: 0, translation_y: -DESIGN.motion.contentShift},
                        {opacity: 255, translation_y: 0, duration: DESIGN.motion.response}]);
                }
                expandedBody.add_child(eventLabel);
            } else if (!spoiler && match?.home_penalties != null) {
                const shootout = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                shootout.add_child(this._label('승부차기', 'archsport-caption'));
                shootout.add_child(this._label(`${match.home_penalties} : ${match.away_penalties}`, 'archsport-result-score'));
                expandedBody.add_child(shootout);
            }
            if (this._expanded) {
                const liveMatch = ['live', 'halftime', 'extra_time', 'penalties', 'interrupted'].includes(match?.status);
                if (liveMatch) {
                    // A pill with a chevron reads as a control, not as one more caption line.
                    const toggleContent = new St.BoxLayout({style_class: 'archsport-context-toggle-content'});
                    toggleContent.add_child(new St.Label({text: this._showContext ? '다른 경기·일정 접기' : '다른 경기·일정 보기',
                        y_align: Clutter.ActorAlign.CENTER}));
                    toggleContent.add_child(new St.Icon({icon_name: this._showContext ? 'pan-up-symbolic' : 'pan-down-symbolic',
                        icon_size: 12, y_align: Clutter.ActorAlign.CENTER}));
                    const contextToggle = new St.Button({child: toggleContent, x_align: Clutter.ActorAlign.CENTER,
                        style_class: 'archsport-context-toggle', can_focus: true,
                        accessible_name: this._showContext ? '다른 경기와 일정 접기' : '다른 경기와 일정 보기'});
                    focusKey(contextToggle, 'context');
                    contextToggle.connect('clicked', () => { this._showContext = !this._showContext; this._render(); });
                    expandedBody.add_child(contextToggle);
                }
                if (!liveMatch || this._showContext) {
                    const context = data.context ?? {};
                    const upcomingMatches = (context.upcoming_matches ?? (context.upcoming ? [context.upcoming] : [])).slice(0, 3);
                    const recent = (context.recent ?? []).slice(0, 2);
                    const stats = context.recent_stats;
                    const otherLive = (context.live_matches ?? []).filter(fixture => fixture.id !== match?.id);
                    if (otherLive.length) {
                        const liveTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                        liveTitle.add_child(this._label('다른 진행 경기', 'archsport-caption'));
                        expandedBody.add_child(liveTitle);
                        for (const fixture of otherLive.slice(0, 2)) {
                            const minute = fixture.status === 'halftime' ? 'HT' : minuteOf(fixture);
                            // Focusable like the schedule rows, so Tab and a screen reader reach it.
                            const row = focusKey(new St.BoxLayout({style_class: 'archsport-fixture-row', can_focus: true,
                                reactive: true, accessible_name: `홈 ${fixture.home} 대 원정 ${fixture.away}, ` +
                                    `${spoiler ? '점수 숨김' : `${fixture.home_score ?? '미확인'} 대 ${fixture.away_score ?? '미확인'}`}, ${minute}`}),
                            `live:${fixture.id}`);
                            row.add_child(this._label(minute, 'archsport-date'));
                            // '[crest] Lazio 1 : 0 Parma [crest]': each crest beside its own name.
                            const homeCrest = this._crestIcon(fixture, 'home', 16);
                            if (homeCrest) row.add_child(homeCrest);
                            row.add_child(this._label(`${displayTeam(fixture, 'home')}  ${spoiler ? '숨김' : `${fixture.home_score ?? '–'} : ${fixture.away_score ?? '–'}`}  ${displayTeam(fixture, 'away')}`,
                                'archsport-context-text'));
                            const awayCrest = this._crestIcon(fixture, 'away', 16);
                            if (awayCrest) row.add_child(awayCrest);
                            expandedBody.add_child(row);
                        }
                    }
                    if (upcomingMatches.length) {
                        const nextTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                        nextTitle.add_child(this._label('다음 경기', 'archsport-caption'));
                        expandedBody.add_child(nextTitle);
                    }
                    for (const upcoming of upcomingMatches)
                        expandedBody.add_child(this._fixtureRow(upcoming));
                    if (recent.length) {
                        const recentTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                        recentTitle.add_child(this._label('최근 경기', 'archsport-caption'));
                        expandedBody.add_child(recentTitle);
                    }
                    for (const fixture of recent)
                        expandedBody.add_child(this._fixtureRow(fixture, {result: true, spoiler}));
                    if (stats?.available && liveMatch) {
                        const values = (stats.team_order ?? []).map(id => stats.values[id] ?? {});
                        const statValue = type => values.map(team => team[type] ?? '–').join(' : ');
                        const statsRow = new St.BoxLayout({style_class: 'archsport-stats'});
                        statsRow.add_child(this._label(`점유 ${statValue('Ball Possession')}`, 'archsport-stat'));
                        statsRow.add_child(this._label(`슈팅 ${statValue('Total Shots')}`, 'archsport-stat'));
                        statsRow.add_child(this._label(`유효 ${statValue('Shots on Goal')}`, 'archsport-stat'));
                        statsRow.add_child(this._label(`코너 ${statValue('Corner Kicks')}`, 'archsport-stat'));
                        expandedBody.add_child(statsRow);
                    }
                    if (!upcomingMatches.length && !recent.length && !match) {
                        const empty = new St.BoxLayout({style_class: 'archsport-empty'});
                        empty.add_child(new St.Icon({icon_name: data.health === 'error' ? 'dialog-warning-symbolic' : 'x-office-calendar-symbolic', icon_size: 18}));
                        empty.add_child(this._label(data.health === 'error' ? '연결 후 일정 표시' : '일정 · 최근 기록 없음', 'archsport-context-text'));
                        expandedBody.add_child(empty);
                    }
                    if (context.schedule_notice && data.health === 'error') {
                        const limit = new St.BoxLayout({style_class: 'archsport-context-row'});
                        limit.add_child(new St.Icon({icon_name: 'dialog-information-symbolic', icon_size: 14}));
                        limit.add_child(this._label('일정 지연 가능 · 경기별 스탯 없음', 'archsport-caption'));
                        expandedBody.add_child(limit);
                    }
                }
            }
            expandedScroll = new St.ScrollView({style_class: 'archsport-scroll', x_expand: true,
                y_expand: false, hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC});
            expandedScroll.set_child(expandedBody);
            this._root.add_child(expandedScroll);
        }
        const expandedPanel = this._expanded || Boolean(alert);
        const width = Math.min(expandedPanel ? (this._showContext || !match ? DESIGN.geometry.archContext :
            DESIGN.geometry.archExpanded) : DESIGN.geometry.archCompact,
            Math.max(1, (this._monitor()?.width ?? 800) - 24));
        // A notch opening from hidden builds an unmapped tree, and unmapped St widgets
        // measure without their CSS box spacing and fonts until styled (the first
        // schedule render used to clip its last row). Style it first so it measures exactly.
        const ensureStyle = actor => {
            actor.ensure_style?.();
            actor.get_children().forEach(ensureStyle);
        };
        ensureStyle(this._root);
        if (expandedPanel) {
            const monitor = this._monitor();
            let panelHeight = 0;
            try {
                if (monitor === Main.layoutManager.primaryMonitor) panelHeight = Main.panel.height;
            } catch (_error) {}
            // The root's own CSS padding and row gap are the only chrome, so the slab is
            // exactly as tall as what it shows: no forehead above the first row.
            const rootNode = this._root.get_theme_node();
            const contentWidth = Math.max(1, width - rootNode.get_horizontal_padding());
            const [, headerNatural] = expandedHeader.get_preferred_height(contentWidth);
            const [, bodyNatural] = expandedBody.get_preferred_height(contentWidth);
            const viewport = calculateExpandedViewport({monitorHeight: monitor?.height ?? 800,
                panelHeight, headerHeight: headerNatural, contentHeight: bodyNatural,
                chromeHeight: rootNode.get_vertical_padding() + rootNode.get_length('spacing')});
            expandedScroll.set_policy(St.PolicyType.NEVER,
                bodyNatural > viewport.bodyHeight + 1 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER);
            expandedScroll.set_height(viewport.bodyHeight);
            this._contentHeight = viewport.rootHeight;
        } else {
            // 34 px at normal text; Large Text (pt fonts) grows the pill instead of clipping it.
            const [, compactNatural] = this._root.get_preferred_height(width);
            this._compactHeight = Math.max(DESIGN.control.compactHeight, Math.ceil(compactNatural));
            this._contentHeight = this._compactHeight;
        }
        this._visibility();
        // Entrances start only now that the slab shows the attached tree; an actor eased
        // before it is attached never plays.
        if (this._interface.get_boolean('enable-animations')) {
            // Content drops into place from the panel edge on the slab's own curve.
            const drop = {opacity: 0, translation_y: -DESIGN.motion.contentShift};
            const settled = {opacity: 255, translation_y: 0};
            if (opening) {
                // A beat after the slab starts.
                entrances.push([expandedHeader, drop, {...settled, duration: DESIGN.motion.primaryDuration,
                    delay: DESIGN.motion.primaryDelay}]);
                entrances.push([expandedScroll, drop, {...settled, duration: DESIGN.motion.secondaryDuration,
                    delay: DESIGN.motion.secondaryDelay}]);
            } else if (closing && this._dock.state.visible) {
                // The compact row grows in over the end of the retract, when the slab is near its size.
                const row = this._root.get_first_child();
                row.set_pivot_point(0.5, 0.5);
                entrances.push([row, {...drop, scale_x: CONTENT_GROW_FROM, scale_y: CONTENT_GROW_FROM},
                    {...settled, scale_x: 1, scale_y: 1, duration: CLOSE_IN_MS}]);
            }
            for (const [actor, from, to] of entrances) {
                Object.assign(actor, from);
                easeOnCurve(actor, to);
            }
        }
        // A goal lights the score green for two event beats, then it settles back to white.
        if (this._flashTimer) GLib.source_remove(this._flashTimer);
        this._flashTimer = 0;
        if (flashes.length) {
            for (const actor of flashes) actor.add_style_class_name('archsport-score-flash');
            this._flashTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2 * DESIGN.motion.event, () => {
                this._flashTimer = 0;
                for (const actor of flashes) {
                    try { actor.remove_style_class_name('archsport-score-flash'); } catch (_error) {}
                }
                return GLib.SOURCE_REMOVE;
            });
        }
        this._renderedExpanded = expanded;
        this._root.accessible_name = `Archsport. ${match ? `${match.home} 대 ${match.away}, ${spokenScore}` : '경기 정보'}. ${clock}`;
        if (this._primaryFocus) this._primaryFocus.accessible_name = this._root.accessible_name;
        if (expanded && focusWasInside)
            (findFocusKey(this._root, focusedKey) ?? this._primaryFocus ?? firstFocusable(this._root))?.grab_key_focus();
        if (alert) this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(this._alertDeadline - now)), () => {
            this._timer = 0; this._activeAlert = null; this._alertAnimate = false; this._render(); this._showPendingAlert();
            return GLib.SOURCE_REMOVE;
        });
        // One tick at each minute boundary of the estimate, only while a running clock is shown.
        // Not while keyboard focus is inside: a rebuild every minute would re-read the focused row.
        if (this._minuteTimer) GLib.source_remove(this._minuteTimer);
        this._minuteTimer = 0;
        const updated = Date.parse(data.updated_at ?? '');
        if (this._dock.state.visible && data.health !== 'error' && Number.isFinite(updated) &&
            ['live', 'extra_time'].includes(match?.status) && !isActorWithin(global.stage.get_key_focus(), this._root)) {
            const untilTick = 60000 - (((Date.now() - updated) % 60000) + 60000) % 60000;
            this._minuteTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, untilTick + 250, () => {
                this._minuteTimer = 0;
                this._render();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _startWorker() {
        if (!this._enabled) return;
        try {
            this._cancel = new Gio.Cancellable();
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
            launcher.set_cwd(this.path);
            launcher.setenv('PYTHONIOENCODING', 'utf-8', true);
            const argv = ['python3', '-u', '-m', 'archsport',
                '--mode', this._settings.get_string('mode'), '--team-name', this._settings.get_string('team-name'),
                '--team-country', this._settings.get_string('team-country'),
                '--watch-teams', this._settings.get_strv('watch-teams').join(','),
                '--poll-seconds', String(this._settings.get_int('poll-seconds')),
                '--daily-budget', String(this._settings.get_int('daily-budget')),
                '--key-revision', String(this._settings.get_int('key-revision')),
                '--ui-version', String(this.metadata.version)];
            if (this._settings.get_string('mode') === 'demo')
                argv.push('--replay', GLib.build_filenamev([this.path, 'data', 'replay-barcelona.json']));
            this._process = launcher.spawnv(argv);
            this._stream = new Gio.DataInputStream({base_stream: this._process.get_stdout_pipe()});
            this._readLine(this._stream, this._generation);
        } catch (_error) { this._workerFailed(); }
    }

    _readLine(stream, generation) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancel, (source, result) => {
            if (!this._enabled || generation !== this._generation) {
                // _stopWorker cannot close a stream with a pending read; release the pipe now.
                try { source.close(null); } catch (_error) { /* already closed */ }
                return;
            }
            try {
                const [line] = source.read_line_finish_utf8(result);
                if (line === null) { this._workerFailed(); return; }
                const nextPayload = JSON.parse(line);
                if (nextPayload.alert?.kind === 'score')
                    nextPayload.alert.scoring_side = scoreDirection(this._payload?.match, nextPayload.match,
                        this._settings.get_strv('watch-teams'));
                this._payload = nextPayload;
                if (this._payload.ui_version_mismatch) this._payload.health = 'error';
                if (nextPayload.health !== 'error') this._failures = 0;
                if (this._pendingAlertRecord) {
                    this._pendingAlerts = restorePendingAlerts(this._pendingAlertRecord, this._payload);
                    this._pendingAlertRecord = null;
                    this._persistPendingAlerts();
                }
                const incoming = this._payload.alert;
                if (incoming && !this._settings.get_boolean('spoiler') &&
                    this._settings.get_boolean('expand-on-event') && this._settings.get_boolean('show-notch')) {
                    enqueuePendingAlert(this._pendingAlerts, incoming);
                    this._persistPendingAlerts();
                }
                this._render();
                this._showPendingAlert();
            } catch (_error) { this._workerFailed(); return; }
            this._readLine(stream, generation);
        });
    }

    _stopWorker() {
        this._generation++;
        this._cancel?.cancel();
        this._process?.force_exit();
        try { this._stream?.close(null); } catch (_error) { /* read cancelled */ }
        this._stream = this._process = this._cancel = null;
        if (this._restartTimer) GLib.source_remove(this._restartTimer);
        this._restartTimer = 0;
    }

    _restartWorker(delay = 500) {
        this._stopWorker();
        if (this._activeAlert) enqueuePendingAlert(this._pendingAlerts, this._activeAlert);
        this._persistPendingAlerts();
        this._activeAlert = null;
        this._alertAnimate = false;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        if (!this._enabled) return;
        this._restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._restartTimer = 0; this._startWorker(); return GLib.SOURCE_REMOVE;
        });
    }

    _workerFailed() {
        const alreadyRunning = this._payload.code === 'WORKER_ALREADY_RUNNING';
        this._payload = {...this._payload, health: 'error',
            message: alreadyRunning ? this._payload.message : '경기 서비스를 다시 시작합니다.'};
        this._render();
        this._failures++;
        this._restartWorker(alreadyRunning ? 60000 : Math.min(60000, 5000 * 2 ** Math.min(this._failures - 1, 4)));
    }

    disable() {
        this._enabled = false;
        Main.wm.removeKeybinding('archsport-toggle-shortcut');
        this._stopWorker();
        if (this._timer) GLib.source_remove(this._timer);
        if (this._pendingAlertTimer) GLib.source_remove(this._pendingAlertTimer);
        if (this._closingTimer) GLib.source_remove(this._closingTimer);
        if (this._announcementTimer) GLib.source_remove(this._announcementTimer);
        if (this._minuteTimer) GLib.source_remove(this._minuteTimer);
        if (this._flashTimer) GLib.source_remove(this._flashTimer);
        this._timer = this._pendingAlertTimer = this._closingTimer = this._announcementTimer = this._minuteTimer = this._flashTimer = 0;
        this._queuedAnnouncement = null;
        if (this._sleepSubscription) Gio.DBus.system.signal_unsubscribe(this._sleepSubscription);
        this._sleepSubscription = 0;
        for (const [object, id] of this._signals ?? []) {
            try { object.disconnect(id); } catch (_error) { /* object was disposed during Shell shutdown */ }
        }
        this._signals = [];
        this._dock?.destroy();
        if (!this._shellEnding && this._root) {
            try { this._root.destroy(); } catch (_error) {}
        }
        if (!this._shellEnding && this._indicator) {
            try {
                if (Main.panel.statusArea[this.uuid] === this._indicator) Main.panel.statusArea[this.uuid] = null;
                this._indicator.destroy();
            } catch (_error) { /* Shell already owns actor disposal */ }
        }
        this._root = this._indicator = this._settings = this._interface = this._payload = this._dock = null;
        this._activeAlert = this._scoreFeedback = this._pendingAlertRecord = null;
        this._pendingAlerts = [];
    }
}
