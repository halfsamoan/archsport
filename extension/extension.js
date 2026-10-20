import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Pango from 'gi://Pango';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {DockParticipant} from './notchDock.js';
import {createNotchSurface} from './notchSurface.js';
import {DESIGN} from './designTokens.js';
import {calculateExpandedViewport, scoreDirection, eventSummary} from './uiModel.js';
import {displayTeam, fixturePresentation} from './fixturePresentation.js';
import {enqueuePendingAlert, expirePendingAlerts, restorePendingAlerts, takePendingAlert} from './alertQueue.js';

const DATA_KEYS = new Set(['mode', 'team-name', 'team-country', 'watch-teams', 'poll-seconds', 'daily-budget', 'key-revision']);
const STATUS = {live: '진행 중', halftime: 'HT', finished: 'FT', scheduled: '경기 전',
    extra_time: '연장', penalties: 'PK', postponed: '연기', cancelled: '취소',
    interrupted: '중단', abandoned: '중단 종료', unknown: '상태 미확인'};

export default class Archsport extends Extension {
    enable() {
        this._enabled = true;
        this._shellEnding = false;
        this._clearPendingRelogin();
        this._generation = 0;
        this._signals = [];
        this._timer = this._restartTimer = this._pendingAlertTimer = 0;
        this._failures = 0;
        this._expanded = false;
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
        this._root = new St.BoxLayout({vertical: true, style_class: 'archsport-notch',
            reactive: false, can_focus: true,
            accessible_name: 'Archsport 경기 노치', clip_to_allocation: true});
        const openDashboard = () => {
            if (!this._dock.claim(100)) return;
            this._expanded = true;
            this._activeAlert = null;
            this._alertAnimate = false;
            this._render();
            this._root.grab_key_focus();
        };
        this._root.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                this._expanded = false; this._activeAlert = null; this._alertAnimate = false; this._render();
                return Clutter.EVENT_STOP;
            }
            if ([Clutter.KEY_Return, Clutter.KEY_space].includes(key)) {
                this._toggle(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._surface = createNotchSurface(this._root);
        Main.layoutManager.addChrome(this._surface, {affectsStruts: false, trackFullscreen: false});
        const staleIndicator = Main.panel.statusArea[this.uuid];
        if (staleIndicator) {
            Main.panel.statusArea[this.uuid] = null;
            staleIndicator.destroy();
        }
        this._indicator = new PanelMenu.Button(0.0, 'Archsport');
        this._indicator.add_child(new St.Icon({icon_name: 'x-office-calendar-symbolic', icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER, accessible_name: '경기 일정'}));
        this._indicator.menu.addAction('노치 펼치기 / 접기', () => this._toggle());
        this._indicator.menu.addAction('일정 · 최근 경기', openDashboard);
        this._indicator.menu.addAction('Archsport 설정', () => this._openPreferences());
        this._indicator.menu.addAction('데이터 다시 연결', () => this._restartWorker());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._dock = new DockParticipant({id: this.uuid, actor: this._surface,
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
        this._connect(Main.layoutManager, 'monitors-changed', () => this._visibility());
        this._connect(Main.panel, 'destroy', () => this._beginShellShutdown());
        this._connect(this._root, 'destroy', () => this._beginShellShutdown());
        this._connect(this._indicator, 'destroy', () => this._beginShellShutdown());
        this._connect(Main.panel, 'notify::height', () => this._visibility());
        this._connect(Main.overview, 'showing', () => this._visibility());
        this._connect(Main.overview, 'hidden', () => this._visibility());
        this._connect(Main.sessionMode, 'updated', () => this._visibility());
        this._connect(global.display, 'in-fullscreen-changed', () => this._visibility());
        this._connect(this._settings, 'changed', (_settings, key) => {
            if (DATA_KEYS.has(key)) this._restartWorker();
            else {
                if (this._settings.get_boolean('spoiler') || !this._settings.get_boolean('expand-on-event') ||
                    !this._settings.get_boolean('show-notch'))
                    this._pendingAlerts = [];
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
        for (const name of ['_timer', '_pendingAlertTimer']) {
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

    _toggle() {
        const expanding = !this._expanded && !this._activeAlert;
        if (expanding && !this._dock.claim(100)) return;
        this._expanded = expanding;
        this._activeAlert = null;
        this._alertAnimate = false;
        this._render();
        if (expanding) this._root.grab_key_focus();
    }

    _monitor() {
        const index = this._settings.get_int('monitor-index');
        return Main.layoutManager.monitors[index] ?? Main.layoutManager.primaryMonitor;
    }

    _visibility() {
        if (!this._enabled || this._shellEnding || !this._dock) return;
        const match = this._payload.match;
        const updated = Date.parse(this._payload.updated_at ?? '');
        const staleAfterMs = (this._payload.stale_after_seconds ?? 300) * 1000;
        const recentlyUpdated = Number.isFinite(updated) && Date.now() - updated >= -30000 &&
            Date.now() - updated <= staleAfterMs;
        const active = this._payload.visible !== false && recentlyUpdated &&
            (this._payload.mode === 'demo' && Boolean(match) ||
                ['live', 'halftime', 'extra_time', 'penalties', 'interrupted'].includes(match?.status));
        const allowed = this._settings.get_boolean('show-notch') && !this._sleeping &&
            (active || Boolean(this._activeAlert) || this._expanded);
        const fullscreen = this._settings.get_boolean('hide-fullscreen') && this._monitor()?.inFullscreen;
        const monitor = this._monitor();
        const expanded = this._expanded || Boolean(this._activeAlert);
        const width = Math.min(expanded ? (this._showContext || !match ? DESIGN.geometry.archContext :
            DESIGN.geometry.archExpanded) : DESIGN.geometry.archCompact,
            Math.max(1, (monitor?.width ?? 800) - 24));
        const height = expanded ? (this._contentHeight ?? (this._activeAlert ? 160 : 180)) : DESIGN.control.compactHeight;
        const visible = allowed && !Main.overview.visible && !Main.sessionMode.isLocked && !fullscreen;
        this._indicator.visible = true;
        this._dock.update({width, height, visible, expanded: height > DESIGN.control.compactHeight});
    }

    _label(text, style) {
        const label = new St.Label({text: String(text), style_class: style, x_align: Clutter.ActorAlign.START});
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
        // Missing crest is a plain name, never a fabricated replacement emblem.
        return this._label(match?.[side] ?? '–', 'archsport-caption');
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
        const alert = takePendingAlert(this._pendingAlerts, () => this._dock.claim(80));
        this._persistPendingAlerts();
        if (!alert) {
            this._schedulePendingAlert();
            return;
        }
        if (this._expanded && alert.kind === 'score') {
            this._scoreFeedback = alert;
            this._render();
            this._schedulePendingAlert();
            return;
        }
        this._activeAlert = alert;
        this._alertAnimate = true;
        this._alertDeadline = GLib.get_monotonic_time() / 1000 + this._settings.get_int('event-seconds') * 1000;
        this._render();
    }

    _render() {
        if (!this._enabled || this._shellEnding) return;
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
        for (const child of this._root.get_children()) child.destroy();
        const data = this._payload;
        const match = data.match;
        const score = spoiler ? '● : ●' : match ? `${match.home_score ?? '–'} : ${match.away_score ?? '–'}` : '– : –';
        const liveMinute = match && match.elapsed != null ? `${match.elapsed}${match.extra ? `+${match.extra}` : ''}′` : '';
        let clock = match ? `${STATUS[match.status] ?? '상태 미확인'} ${liveMinute}`.trim() : '';
        if (match?.status === 'scheduled' && match.kickoff_utc) {
            clock = new Date(match.kickoff_utc).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
        }
        const expanded = this._expanded || Boolean(alert);
        const opening = expanded && !this._renderedExpanded;
        const closing = !expanded && this._renderedExpanded;
        let expandedHeader = null;
        let expandedBody = null;
        let expandedScroll = null;
        let fixtureRows = 0;
        if (!expanded) {
            this._root.remove_style_class_name('archsport-open');
            const row = new St.BoxLayout({style_class: 'archsport-compact',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            if (match) row.add_child(this._logo(match, 'home', 20));
            row.add_child(this._label(score, 'archsport-team'));
            if (match) row.add_child(this._logo(match, 'away', 20));
            const compactStatus = data.mode === 'demo' ? '시연' : data.health === 'error' ? '오프라인' :
                match?.status === 'halftime' ? 'HT' : match?.status === 'scheduled' ? '예정' : liveMinute;
            if (compactStatus)
                row.add_child(this._label(compactStatus, data.health === 'error' ? 'archsport-alert' : 'archsport-caption'));
            const compact = new St.Button({style_class: 'archsport-compact-button', can_focus: true, x_expand: true,
                accessible_name: `${match?.home ?? '축구'} ${score}, ${match?.away ?? ''} ${clock || '경기 정보'}. 펼쳐서 일정과 최근 경기 보기`});
            compact.set_child(row);
            compact.connect('clicked', () => this._toggle());
            this._root.add_child(compact);
        } else {
            this._root.add_style_class_name('archsport-open');
            const header = new St.BoxLayout({style_class: 'archsport-header'});
            const identity = new St.BoxLayout({style_class: 'archsport-identity'});
            identity.add_child(this._watchedCrestIcon(match, 18) ?? new St.Icon({
                icon_name: 'x-office-calendar-symbolic', icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER, accessible_name: '경기 일정'}));
            const alertTitle = alert?.kind === 'score' ?
                alert.scoring_side === 'watched' ? 'GOAL' : alert.scoring_side === 'opponent' ? '득점' : alert.title : alert?.title;
            identity.add_child(this._label(data.mode === 'demo' && alertTitle ? `시연 · ${alertTitle}` :
                alertTitle || (data.mode === 'demo' ? '시연' : data.health === 'error' ?
                    (data.ui_version_mismatch ? data.message : '오프라인') : clock || '경기 정보'),
                alert ? 'archsport-event-title' : data.health === 'error' ? 'archsport-alert' : 'archsport-live'));
            header.add_child(identity);
            const tools = new St.BoxLayout({style_class: 'archsport-tools'});
            tools.add_child(this._iconButton('preferences-system-symbolic', '설정', () => this._openPreferences()));
            tools.add_child(this._iconButton('pan-up-symbolic', '접기', () => { this._expanded = false; this._activeAlert = null; this._alertAnimate = false; this._render(); }));
            header.add_child(tools);
            this._root.add_child(header);
            expandedHeader = header;
            expandedBody = new St.BoxLayout({vertical: true, style_class: 'archsport-body'});

            if (alert?.kind === 'kickoff') {
                const reminder = new St.BoxLayout({style_class: 'archsport-context-row'});
                reminder.add_child(new St.Icon({icon_name: 'alarm-symbolic', icon_size: 17}));
                reminder.add_child(this._label(`${alert.club}  ·  ${alert.opponent}`, 'archsport-event'));
                expandedBody.add_child(reminder);
            }
            if (match && match.status !== 'scheduled') {
                const scoreboard = new St.BoxLayout({style_class: 'archsport-scoreboard', x_expand: true});
                const home = new St.BoxLayout({style_class: 'archsport-side', vertical: true, x_expand: true});
                const homeLogo = this._crestIcon(match, 'home', 34);
                if (homeLogo) {
                    homeLogo.x_align = Clutter.ActorAlign.CENTER;
                    home.add_child(homeLogo);
                } else home.add_child(new St.Widget({height: 34}));
                const homeName = this._label(displayTeam(match, 'home'), 'archsport-team-name');
                homeName.accessible_name = match.home;
                homeName.x_align = Clutter.ActorAlign.CENTER;
                home.add_child(homeName);
                const away = new St.BoxLayout({style_class: 'archsport-side', vertical: true, x_expand: true});
                const awayLogo = this._crestIcon(match, 'away', 34);
                if (awayLogo) {
                    awayLogo.x_align = Clutter.ActorAlign.CENTER;
                    away.add_child(awayLogo);
                } else away.add_child(new St.Widget({height: 34}));
                const awayName = this._label(displayTeam(match, 'away'), 'archsport-team-name');
                awayName.accessible_name = match.away;
                awayName.x_align = Clutter.ActorAlign.CENTER;
                away.add_child(awayName);
                scoreboard.add_child(home);
                const scoreLabel = this._label(score, 'archsport-score');
                scoreLabel.y_align = Clutter.ActorAlign.CENTER;
                if (incoming?.kind === 'score') {
                    scoreLabel.opacity = 0;
                    scoreLabel.translation_y = 4;
                    scoreLabel.ease({opacity: 255, translation_y: 0,
                        duration: this._interface.get_boolean('enable-animations') ? DESIGN.motion.event : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                    for (const crest of [homeLogo, awayLogo].filter(Boolean)) {
                        crest.scale_x = crest.scale_y = 0.9;
                        crest.ease({scale_x: 1, scale_y: 1,
                            duration: this._interface.get_boolean('enable-animations') ? DESIGN.motion.event : 0,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                    }
                }
                scoreboard.add_child(scoreLabel);
                scoreboard.add_child(away);
                expandedBody.add_child(scoreboard);
            }
            const events = match?.events ?? [];
            const latest = alert?.kind === 'score' ? events.filter(e => e.kind === 'Goal' && e.detail !== 'Missed Penalty').at(-1) : events.at(-1);
            if (latest && !spoiler) {
                const eventLabel = this._label(eventSummary(latest), 'archsport-event');
                if (incoming && !localScoreFeedback) {
                    eventLabel.opacity = 0;
                    eventLabel.translation_y = 7;
                    eventLabel.ease({opacity: 255, translation_y: 0,
                        duration: this._interface.get_boolean('enable-animations') ? DESIGN.motion.response : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
                expandedBody.add_child(eventLabel);
            } else if (match?.home_penalties != null) {
                expandedBody.add_child(this._label(`PK  ${match.home_penalties} : ${match.away_penalties}`, 'archsport-event'));
            }
            if (this._expanded) {
                const liveMatch = ['live', 'halftime', 'extra_time', 'penalties', 'interrupted'].includes(match?.status);
                if (liveMatch) {
                    const contextToggle = new St.Button({label: this._showContext ? '다른 경기·일정 접기' : '다른 경기·일정 보기',
                        style_class: 'archsport-context-toggle', can_focus: true});
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
                        liveTitle.add_child(new St.Icon({icon_name: 'media-record-symbolic', icon_size: 12}));
                        liveTitle.add_child(this._label('다른 진행 경기', 'archsport-caption'));
                        expandedBody.add_child(liveTitle);
                        for (const fixture of otherLive.slice(0, 2)) {
                            fixtureRows++;
                            const row = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                            row.add_child(this._label(`${fixture.elapsed ?? ''}′`, 'archsport-date'));
                            for (const side of ['home', 'away']) {
                                const crest = this._crestIcon(fixture, side, 16);
                                if (crest) row.add_child(crest);
                            }
                            const label = this._label(`${displayTeam(fixture, 'home')}  ${spoiler ? '● : ●' : `${fixture.home_score ?? '–'} : ${fixture.away_score ?? '–'}`}  ${displayTeam(fixture, 'away')}`,
                                'archsport-context-text');
                            label.x_expand = true;
                            label.accessible_name = `${fixture.home} 대 ${fixture.away}, 홈 ${fixture.home_score ?? '미확인'} 대 원정 ${fixture.away_score ?? '미확인'}`;
                            row.add_child(label);
                            expandedBody.add_child(row);
                        }
                    }
                    if (upcomingMatches.length) {
                        const nextTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                        nextTitle.add_child(new St.Icon({icon_name: 'x-office-calendar-symbolic', icon_size: 14}));
                        nextTitle.add_child(this._label('다음 경기', 'archsport-caption'));
                        expandedBody.add_child(nextTitle);
                    }
                    for (const upcoming of upcomingMatches) {
                        fixtureRows++;
                        const presentation = fixturePresentation(upcoming, this._settings.get_strv('watch-teams'));
                        const nextRow = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                        nextRow.accessible_name = presentation.accessibleName;
                        if (presentation.crestSide) {
                            const crest = this._crestIcon(upcoming, presentation.crestSide, 17);
                            if (crest) nextRow.add_child(crest);
                            else nextRow.add_child(this._label(presentation.watchedName, 'archsport-watch-name'));
                        }
                        const opponent = this._label(presentation.primary, 'archsport-context-text');
                        opponent.x_expand = true;
                        opponent.accessible_name = presentation.accessibleName;
                        nextRow.add_child(opponent);
                        nextRow.add_child(this._label(`${presentation.direction ? `${presentation.direction} · ` : ''}${presentation.shortDate}`,
                            'archsport-date'));
                        expandedBody.add_child(nextRow);
                    }
                    if (recent.length) {
                        const recentTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                        recentTitle.add_child(new St.Icon({icon_name: 'document-open-recent-symbolic', icon_size: 14}));
                        recentTitle.add_child(this._label('최근 경기', 'archsport-caption'));
                        expandedBody.add_child(recentTitle);
                    }
                    for (const fixture of recent) {
                        fixtureRows++;
                        const presentation = fixturePresentation(fixture, this._settings.get_strv('watch-teams'),
                            {result: true, spoiler});
                        const fixtureRow = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                        fixtureRow.accessible_name = presentation.accessibleName;
                        if (presentation.crestSide) {
                            const crest = this._crestIcon(fixture, presentation.crestSide, 16);
                            if (crest) fixtureRow.add_child(crest);
                            else fixtureRow.add_child(this._label(presentation.watchedName, 'archsport-watch-name'));
                        }
                        const opponent = this._label(presentation.primary, 'archsport-context-text');
                        opponent.x_expand = true;
                        opponent.accessible_name = presentation.accessibleName;
                        fixtureRow.add_child(opponent);
                        fixtureRow.add_child(this._label(presentation.score, 'archsport-result-score'));
                        fixtureRow.add_child(this._label(presentation.shortDate, 'archsport-date'));
                        expandedBody.add_child(fixtureRow);
                    }
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
        if (expandedPanel) {
            const monitor = this._monitor();
            let panelHeight = 0;
            try {
                if (monitor === Main.layoutManager.primaryMonitor) panelHeight = Main.panel.height;
            } catch (_error) {}
            const contentWidth = Math.max(1, width - 2 * DESIGN.spacing.lg);
            const [, headerNatural] = expandedHeader.get_preferred_height(contentWidth);
            const [, bodyNatural] = expandedBody.get_preferred_height(contentWidth);
            // St can report a shorter preferred height before fixture labels settle in the idle schedule.
            const bodyEstimate = bodyNatural + (!match || match.status === 'scheduled' ? fixtureRows * 6 : 0);
            const viewport = calculateExpandedViewport({monitorHeight: monitor?.height ?? 800,
                panelHeight, headerHeight: headerNatural, contentHeight: bodyEstimate});
            expandedScroll.set_policy(St.PolicyType.NEVER,
                bodyEstimate > viewport.bodyHeight + 1 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER);
            expandedScroll.set_height(viewport.bodyHeight);
            this._contentHeight = viewport.rootHeight + 26;
        } else {
            this._contentHeight = DESIGN.control.compactHeight;
        }
        this._visibility();
        if (this._interface.get_boolean('enable-animations')) {
            if (opening) {
                for (const actor of [expandedHeader, expandedScroll]) {
                    if (actor === expandedScroll && match && match.status !== 'scheduled') continue;
                    actor.opacity = 0;
                    actor.translation_y = 4;
                    actor.ease({opacity: 255, translation_y: 0,
                        duration: actor === expandedScroll ? DESIGN.motion.secondaryDuration : DESIGN.motion.primaryDuration,
                        delay: actor === expandedScroll ? DESIGN.motion.secondaryDelay : DESIGN.motion.primaryDelay,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
            } else if (closing) {
                const compact = this._root.get_first_child();
                if (compact) {
                    compact.opacity = 0;
                    compact.ease({opacity: 255, duration: DESIGN.motion.micro,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
            }
        }
        this._renderedExpanded = expanded;
        this._root.accessible_name = `Archsport. ${match?.home ?? '축구'} ${score} ${match?.away ?? ''}. ${clock}`;
        if (alert) this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(this._alertDeadline - now)), () => {
            this._timer = 0; this._activeAlert = null; this._alertAnimate = false; this._render(); this._showPendingAlert();
            return GLib.SOURCE_REMOVE;
        });
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
            if (!this._enabled || generation !== this._generation) return;
            try {
                const [line] = source.read_line_finish_utf8(result);
                if (line === null) { this._workerFailed(); return; }
                const nextPayload = JSON.parse(line);
                if (nextPayload.alert?.kind === 'score')
                    nextPayload.alert.scoring_side = scoreDirection(this._payload?.match, nextPayload.match,
                        this._settings.get_strv('watch-teams'));
                this._payload = nextPayload;
                if (this._payload.ui_version_mismatch) this._payload.health = 'error';
                this._failures = 0;
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
        this._stopWorker();
        if (this._timer) GLib.source_remove(this._timer);
        if (this._pendingAlertTimer) GLib.source_remove(this._pendingAlertTimer);
        this._timer = 0;
        if (this._sleepSubscription) Gio.DBus.system.signal_unsubscribe(this._sleepSubscription);
        this._sleepSubscription = 0;
        for (const [object, id] of this._signals ?? []) {
            try { object.disconnect(id); } catch (_error) { /* object was disposed during Shell shutdown */ }
        }
        this._signals = [];
        this._dock?.destroy();
        if (!this._shellEnding && this._surface) {
            try { Main.layoutManager.removeChrome(this._surface); } catch (_error) {}
            try { this._surface.destroy(); } catch (_error) {}
        }
        if (!this._shellEnding && this._indicator) {
            try {
                if (Main.panel.statusArea[this.uuid] === this._indicator) Main.panel.statusArea[this.uuid] = null;
                this._indicator.destroy();
            } catch (_error) { /* Shell already owns actor disposal */ }
        }
        this._surface = this._root = this._indicator = this._settings = this._interface = this._payload = this._dock = null;
    }
}
