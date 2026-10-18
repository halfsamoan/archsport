import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Pango from 'gi://Pango';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {DockParticipant} from './notchDock.js';
import {enqueuePendingAlert, takePendingAlert} from './dockModel.js';

const DATA_KEYS = new Set(['mode', 'team-name', 'team-country', 'watch-teams', 'poll-seconds', 'daily-budget', 'key-revision']);
const STATUS = {live: '진행 중', halftime: 'HT', finished: 'FT', scheduled: '경기 전',
    extra_time: '연장', penalties: 'PK', postponed: '연기', cancelled: '취소',
    interrupted: '중단', abandoned: '중단 종료', unknown: '상태 미확인'};

export default class Archsport extends Extension {
    enable() {
        this._enabled = true;
        this._generation = 0;
        this._signals = [];
        this._timer = this._restartTimer = this._pendingAlertTimer = 0;
        this._failures = 0;
        this._expanded = false;
        this._dockStateKey = null;
        this._sleeping = false;
        this._activeAlert = null;
        this._pendingAlerts = [];
        this._alertDeadline = 0;
        this._payload = {mode: 'live', health: 'loading', visible: false, message: '경기 정보 연결 중'};
        this._settings = this.getSettings();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._root = new St.BoxLayout({vertical: true, style_class: 'archsport-notch',
            reactive: false, can_focus: true, width: 280, height: 46,
            accessible_name: 'Archsport 경기 노치', clip_to_allocation: true});
        const openDashboard = () => {
            if (!this._dock.claim(100)) return;
            this._expanded = true;
            this._activeAlert = null;
            this._render();
            this._root.grab_key_focus();
        };
        this._root.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                this._expanded = false; this._activeAlert = null; this._render();
                return Clutter.EVENT_STOP;
            }
            if ([Clutter.KEY_Return, Clutter.KEY_space].includes(key)) {
                this._toggle(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.addChrome(this._root, {affectsStruts: false, trackFullscreen: true});
        const staleIndicator = Main.panel.statusArea[this.uuid];
        if (staleIndicator) {
            Main.panel.statusArea[this.uuid] = null;
            staleIndicator.destroy();
        }
        this._indicator = new PanelMenu.Button(0.0, 'Archsport');
        this._indicator.add_child(new St.Label({text: '⚽', y_align: Clutter.ActorAlign.CENTER}));
        this._indicator.menu.addAction('노치 펼치기 / 접기', () => this._toggle());
        this._indicator.menu.addAction('일정 · 최근 경기', openDashboard);
        this._indicator.menu.addAction('Archsport 설정', () => this.openPreferences());
        this._indicator.menu.addAction('데이터 다시 연결', () => this._restartWorker());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._dock = new DockParticipant({id: this.uuid, actor: this._root,
            monitor: () => this._monitor(), order: 0, onYield: () => {
                if (this._activeAlert) enqueuePendingAlert(this._pendingAlerts, this._activeAlert);
                this._expanded = false; this._activeAlert = null;
                if (this._timer) GLib.source_remove(this._timer);
                this._timer = 0;
                this._render(); this._schedulePendingAlert();
            }});
        this._connect(Main.layoutManager, 'monitors-changed', () => this._visibility());
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
                this._activeAlert = null;
                this._render();
                this._showPendingAlert();
            }
        });
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

    _toggle() {
        const expanding = !this._expanded && !this._activeAlert;
        if (expanding && !this._dock.claim(100)) return;
        this._expanded = expanding;
        this._activeAlert = null;
        this._render();
        if (expanding) this._root.grab_key_focus();
    }

    _monitor() {
        const index = this._settings.get_int('monitor-index');
        return Main.layoutManager.monitors[index] ?? Main.layoutManager.primaryMonitor;
    }

    _visibility() {
        if (!this._enabled || !this._dock) return;
        const match = this._payload.match;
        const updated = Date.parse(this._payload.updated_at ?? '');
        const recentlyUpdated = Number.isFinite(updated) && Date.now() - updated >= -30000 &&
            Date.now() - updated <= 300000;
        const active = this._payload.visible !== false && recentlyUpdated &&
            (this._payload.mode === 'demo' && Boolean(match) ||
                ['live', 'halftime', 'extra_time', 'penalties', 'interrupted'].includes(match?.status));
        const allowed = this._settings.get_boolean('show-notch') && !this._sleeping &&
            (active || Boolean(this._activeAlert) || this._expanded);
        const fullscreen = this._settings.get_boolean('hide-fullscreen') && this._monitor()?.inFullscreen;
        const monitor = this._monitor();
        const expanded = this._expanded || Boolean(this._activeAlert);
        const width = Math.min(expanded ? 520 : 280,
            Math.max(1, (monitor?.width ?? 800) - 24));
        const height = expanded ? (this._contentHeight ?? (this._activeAlert ? 160 : 180)) : 46;
        const visible = allowed && !Main.overview.visible && !Main.sessionMode.isLocked && !fullscreen;
        const geometry = `${width}:${height}`;
        if (geometry !== this._geometry) {
            this._geometry = geometry;
            this._root.remove_all_transitions();
            this._root.ease({width, height, duration: this._interface.get_boolean('enable-animations') ? 320 : 0,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
        this._indicator.visible = true;
        const key = JSON.stringify([width, height, visible, monitor?.x, monitor?.y,
            monitor?.width, monitor?.height, Main.panel.height]);
        if (key !== this._dockStateKey) {
            this._dockStateKey = key;
            this._dock.update({width, height, visible, expanded: height > 46});
        }
    }

    _label(text, style) {
        const label = new St.Label({text: String(text), style_class: style, x_align: Clutter.ActorAlign.START});
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }

    _iconButton(iconName, accessibleName, action) {
        const button = new St.Button({style_class: 'archsport-icon-button', can_focus: true,
            accessible_name: accessibleName,
            child: new St.Icon({icon_name: iconName, icon_size: 16})});
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
        const path = match?.[`${side}_logo_path`];
        if (!path || !GLib.file_test(path, GLib.FileTest.IS_REGULAR)) return null;
        return new St.Icon({gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
            icon_size: size, accessible_name: match[side], y_align: Clutter.ActorAlign.CENTER});
    }

    _schedulePendingAlert() {
        if (!this._enabled || !this._pendingAlerts.length || this._pendingAlertTimer) return;
        this._pendingAlertTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._pendingAlertTimer = 0;
            this._showPendingAlert();
            return GLib.SOURCE_REMOVE;
        });
    }

    _showPendingAlert() {
        if (!this._enabled || !this._pendingAlerts.length || this._activeAlert) return;
        if (this._settings.get_boolean('spoiler') || !this._settings.get_boolean('expand-on-event') ||
            !this._settings.get_boolean('show-notch')) {
            this._pendingAlerts = [];
            return;
        }
        const monitor = this._monitor();
        if (Main.overview.visible || Main.sessionMode.isLocked ||
            (this._settings.get_boolean('hide-fullscreen') && monitor?.inFullscreen)) {
            this._schedulePendingAlert();
            return;
        }
        const alert = takePendingAlert(this._pendingAlerts, () => this._dock.claim(80));
        if (!alert) {
            this._schedulePendingAlert();
            return;
        }
        this._activeAlert = alert;
        this._alertDeadline = GLib.get_monotonic_time() / 1000 + this._settings.get_int('event-seconds') * 1000;
        this._render();
    }

    _render() {
        if (!this._enabled) return;
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const now = GLib.get_monotonic_time() / 1000;
        const spoiler = this._settings.get_boolean('spoiler');
        if (spoiler || !this._settings.get_boolean('expand-on-event')) this._activeAlert = null;
        else if (this._activeAlert && now >= this._alertDeadline) this._activeAlert = null;
        const alert = this._activeAlert;
        this._root.remove_all_children();
        const data = this._payload;
        const match = data.match;
        const score = spoiler ? '● : ●' : match ? `${match.home_score ?? '–'} : ${match.away_score ?? '–'}` : '– : –';
        const liveMinute = match && match.elapsed != null ? `${match.elapsed}${match.extra ? `+${match.extra}` : ''}′` : '';
        let clock = match ? `${STATUS[match.status] ?? '상태 미확인'} ${liveMinute}`.trim() : '';
        if (match?.status === 'scheduled' && match.kickoff_utc) {
            clock = new Date(match.kickoff_utc).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
        }
        const expanded = this._expanded || Boolean(alert);
        if (!expanded) {
            this._root.remove_style_class_name('archsport-open');
            const row = new St.BoxLayout({style_class: 'archsport-compact',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            if (match) row.add_child(this._logo(match, 'home', 20));
            row.add_child(this._label(score, 'archsport-team'));
            if (match) row.add_child(this._logo(match, 'away', 20));
            const status = new St.BoxLayout({style_class: data.health === 'error' ? 'archsport-state-stale' : 'archsport-state-live'});
            status.add_child(new St.Icon({icon_name: data.health === 'error' ? 'dialog-warning-symbolic' : 'media-record-symbolic', icon_size: 10}));
            status.add_child(this._label(data.mode === 'demo' ? 'DEMO' : data.health === 'error' ? '오프라인' : match?.status === 'halftime' ? 'HT' : liveMinute, 'archsport-live'));
            row.add_child(status);
            const compact = new St.Button({style_class: 'archsport-compact-button', can_focus: true, x_expand: true,
                accessible_name: `${match?.home ?? '축구'} ${score}, ${match?.away ?? ''} ${clock || '경기 정보'}. 펼쳐서 일정과 최근 경기 보기`});
            compact.set_child(row);
            compact.connect('clicked', () => this._toggle());
            this._root.add_child(compact);
        } else {
            this._root.add_style_class_name('archsport-open');
            const header = new St.BoxLayout({style_class: 'archsport-header'});
            const identity = new St.BoxLayout({style_class: 'archsport-identity'});
            identity.add_child(this._label('⚽', 'archsport-brand'));
            identity.add_child(this._label(alert?.title || (data.mode === 'demo' ? '시연' : data.health === 'error' ? '오프라인' : clock || '경기 정보'),
                alert ? 'archsport-alert' : 'archsport-live'));
            header.add_child(identity);
            const tools = new St.BoxLayout({style_class: 'archsport-tools'});
            tools.add_child(this._iconButton('preferences-system-symbolic', '설정', () => this.openPreferences()));
            tools.add_child(this._iconButton('pan-up-symbolic', '접기', () => { this._expanded = false; this._activeAlert = null; this._render(); }));
            header.add_child(tools);
            this._root.add_child(header);

            if (alert?.kind === 'kickoff') {
                const reminder = new St.BoxLayout({style_class: 'archsport-context-row'});
                reminder.add_child(new St.Icon({icon_name: 'alarm-symbolic', icon_size: 17}));
                reminder.add_child(this._label(`${alert.club}  ·  ${alert.opponent}`, 'archsport-event'));
                this._root.add_child(reminder);
            }
            if (match && match.status !== 'scheduled') {
                const scoreboard = new St.BoxLayout({style_class: 'archsport-scoreboard'});
                const home = new St.BoxLayout({style_class: 'archsport-side'});
                home.add_child(this._logo(match, 'home', 34));
                home.add_child(this._label(match.home, 'archsport-team-name'));
                const away = new St.BoxLayout({style_class: 'archsport-side'});
                away.add_child(this._logo(match, 'away', 34));
                away.add_child(this._label(match.away, 'archsport-team-name'));
                scoreboard.add_child(home);
                const scoreLabel = this._label(score, 'archsport-score');
                if (incoming?.kind === 'score') {
                    scoreLabel.opacity = 0;
                    scoreLabel.scale_x = 0.82;
                    scoreLabel.scale_y = 0.82;
                    scoreLabel.ease({opacity: 255, scale_x: 1, scale_y: 1,
                        duration: this._interface.get_boolean('enable-animations') ? 360 : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
                scoreboard.add_child(scoreLabel);
                scoreboard.add_child(away);
                this._root.add_child(scoreboard);
            }
            const events = match?.events ?? [];
            const latest = alert?.kind === 'score' ? events.filter(e => e.kind === 'Goal' && e.detail !== 'Missed Penalty').at(-1) : events.at(-1);
            if (alert && latest && !spoiler) {
                const eventLabel = this._label(`${latest.elapsed ?? ''}′ · ${latest.player} · ${latest.detail}`, 'archsport-event');
                if (incoming) {
                    eventLabel.opacity = 0;
                    eventLabel.translation_y = 7;
                    eventLabel.ease({opacity: 255, translation_y: 0,
                        duration: this._interface.get_boolean('enable-animations') ? 260 : 0,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
                this._root.add_child(eventLabel);
            } else if (match?.home_penalties != null) {
                this._root.add_child(this._label(`PK  ${match.home_penalties} : ${match.away_penalties}`, 'archsport-event'));
            }
            if (this._expanded) {
                const context = data.context ?? {};
                const upcomingMatches = (context.upcoming_matches ?? (context.upcoming ? [context.upcoming] : [])).slice(0, 3);
                const recent = (context.recent ?? []).slice(0, 6);
                const stats = context.recent_stats;
                const otherLive = (context.live_matches ?? []).filter(fixture => fixture.id !== match?.id);
                if (otherLive.length) {
                    const liveTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                    liveTitle.add_child(new St.Icon({icon_name: 'media-record-symbolic', icon_size: 12}));
                    liveTitle.add_child(this._label('다른 진행 경기', 'archsport-caption'));
                    this._root.add_child(liveTitle);
                    for (const fixture of otherLive.slice(0, 2)) {
                        const row = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                        row.add_child(this._label(`${fixture.elapsed ?? ''}′`, 'archsport-date'));
                        for (const side of ['home', 'away']) {
                            const crest = this._crestIcon(fixture, side, 16);
                            if (crest) row.add_child(crest);
                        }
                        row.add_child(this._label(`${fixture.home}  ${spoiler ? '● : ●' : `${fixture.home_score ?? '–'} : ${fixture.away_score ?? '–'}`}  ${fixture.away}`,
                            'archsport-context-text'));
                        this._root.add_child(row);
                    }
                }
                if (upcomingMatches.length) {
                    const nextTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                    nextTitle.add_child(new St.Icon({icon_name: 'x-office-calendar-symbolic', icon_size: 14}));
                    nextTitle.add_child(this._label('다음 경기', 'archsport-caption'));
                    this._root.add_child(nextTitle);
                }
                for (const upcoming of upcomingMatches) {
                    const nextRow = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                    nextRow.add_child(this._label(
                        new Date(upcoming.kickoff_utc).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit'}),
                        'archsport-date'));
                    for (const side of ['home', 'away']) {
                        const crest = this._crestIcon(upcoming, side, 16);
                        if (crest) nextRow.add_child(crest);
                    }
                    nextRow.add_child(this._label(`${upcoming.home} — ${upcoming.away}`, 'archsport-context-text'));
                    this._root.add_child(nextRow);
                }
                if (recent.length) {
                    const recentTitle = new St.BoxLayout({style_class: 'archsport-section-title'});
                    recentTitle.add_child(new St.Icon({icon_name: 'document-open-recent-symbolic', icon_size: 14}));
                    recentTitle.add_child(this._label('최근 경기', 'archsport-caption'));
                    recentTitle.add_child(new St.Label({text: String(recent.length), style_class: 'archsport-count'}));
                    this._root.add_child(recentTitle);
                }
                for (const fixture of recent) {
                    const result = spoiler ? '● : ●' : `${fixture.home_score ?? '–'} : ${fixture.away_score ?? '–'}`;
                    const date = fixture.kickoff_utc ? new Date(fixture.kickoff_utc).toLocaleDateString() : '';
                    const fixtureRow = new St.BoxLayout({style_class: 'archsport-fixture-row'});
                    fixtureRow.add_child(this._label(date, 'archsport-date'));
                    for (const side of ['home', 'away']) {
                        const crest = this._crestIcon(fixture, side, 15);
                        if (crest) fixtureRow.add_child(crest);
                    }
                    fixtureRow.add_child(this._label(`${fixture.home}  ${result}  ${fixture.away}`, 'archsport-context-text'));
                    this._root.add_child(fixtureRow);
                }
                if (stats?.available) {
                    const values = (stats.team_order ?? []).map(id => stats.values[id] ?? {});
                    const statValue = type => values.map(team => team[type] ?? '–').join(' : ');
                    const statsRow = new St.BoxLayout({style_class: 'archsport-stats'});
                    statsRow.add_child(this._label(`점유 ${statValue('Ball Possession')}`, 'archsport-stat'));
                    statsRow.add_child(this._label(`슈팅 ${statValue('Total Shots')}`, 'archsport-stat'));
                    statsRow.add_child(this._label(`유효 ${statValue('Shots on Goal')}`, 'archsport-stat'));
                    statsRow.add_child(this._label(`코너 ${statValue('Corner Kicks')}`, 'archsport-stat'));
                    this._root.add_child(statsRow);
                }
                if (!upcomingMatches.length && !recent.length && !match) {
                    const empty = new St.BoxLayout({style_class: 'archsport-empty'});
                    empty.add_child(new St.Icon({icon_name: data.health === 'error' ? 'dialog-warning-symbolic' : 'x-office-calendar-symbolic', icon_size: 18}));
                    empty.add_child(this._label(data.health === 'error' ? '연결 후 일정 표시' : '일정 · 최근 기록 없음', 'archsport-context-text'));
                    this._root.add_child(empty);
                }
                if (context.schedule_notice) {
                    const limit = new St.BoxLayout({style_class: 'archsport-context-row'});
                    limit.add_child(new St.Icon({icon_name: 'dialog-information-symbolic', icon_size: 14}));
                    limit.add_child(this._label('일정 지연 가능 · 경기별 스탯 없음', 'archsport-caption'));
                    this._root.add_child(limit);
                }
            }
        }
        const expandedPanel = this._expanded || Boolean(alert);
        const width = Math.min(expandedPanel ? 520 : 280, Math.max(1, (this._monitor()?.width ?? 800) - 24));
        if (expandedPanel) {
            const contentWidth = Math.max(1, width - 40);
            const children = this._root.get_children();
            const childHeight = children.reduce((sum, child) => {
                const [, natural] = child.get_preferred_height(contentWidth);
                return sum + natural;
            }, 0);
            this._contentHeight = Math.min(this._expanded ? 370 : 180, Math.max(96,
                Math.ceil(childHeight + Math.max(0, children.length - 1) * 8 + 27)));
        } else {
            this._contentHeight = 46;
        }
        this._visibility();
        this._root.accessible_name = `Archsport. ${match?.home ?? '축구'} ${score} ${match?.away ?? ''}. ${clock}`;
        if (alert) this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(this._alertDeadline - now)), () => {
            this._timer = 0; this._activeAlert = null; this._render(); this._showPendingAlert();
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
                '--key-revision', String(this._settings.get_int('key-revision'))];
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
                this._payload = JSON.parse(line);
                this._failures = 0;
                const incoming = this._payload.alert;
                if (incoming && !this._settings.get_boolean('spoiler') &&
                    this._settings.get_boolean('expand-on-event') && this._settings.get_boolean('show-notch'))
                    enqueuePendingAlert(this._pendingAlerts, incoming);
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
        this._activeAlert = null;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        if (!this._enabled) return;
        this._restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._restartTimer = 0; this._startWorker(); return GLib.SOURCE_REMOVE;
        });
    }

    _workerFailed() {
        this._payload = {...this._payload, health: 'error', message: '경기 서비스를 다시 시작합니다.'};
        this._render();
        this._failures++;
        this._restartWorker(Math.min(60000, 5000 * 2 ** Math.min(this._failures - 1, 4)));
    }

    disable() {
        this._enabled = false;
        this._stopWorker();
        if (this._timer) GLib.source_remove(this._timer);
        if (this._pendingAlertTimer) GLib.source_remove(this._pendingAlertTimer);
        this._timer = 0;
        if (this._sleepSubscription) Gio.DBus.system.signal_unsubscribe(this._sleepSubscription);
        this._sleepSubscription = 0;
        for (const [object, id] of this._signals ?? []) object.disconnect(id);
        this._signals = [];
        this._dock?.destroy();
        if (this._root) Main.layoutManager.removeChrome(this._root);
        this._root?.destroy();
        if (this._indicator) {
            if (Main.panel.statusArea[this.uuid] === this._indicator) Main.panel.statusArea[this.uuid] = null;
            this._indicator.destroy();
        }
        this._root = this._indicator = this._settings = this._interface = this._payload = this._dock = null;
    }
}
