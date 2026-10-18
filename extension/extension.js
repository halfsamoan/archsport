import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {DockParticipant} from './notchDock.js';

const DATA_KEYS = new Set(['mode', 'team-name', 'team-country', 'poll-seconds', 'daily-budget', 'key-revision']);
const STATUS = {live: '진행 중', halftime: 'HT', finished: 'FT', scheduled: '경기 전',
    extra_time: '연장', penalties: 'PK', postponed: '연기', cancelled: '취소',
    interrupted: '중단', abandoned: '중단 종료', unknown: '상태 미확인'};

export default class Archsport extends Extension {
    enable() {
        this._enabled = true;
        this._generation = 0;
        this._signals = [];
        this._timer = this._restartTimer = 0;
        this._failures = 0;
        this._expanded = false;
        this._activeAlert = null;
        this._alertDeadline = 0;
        this._payload = {mode: 'live', health: 'loading', message: '경기 정보 연결 중'};
        this._settings = this.getSettings();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._root = new St.BoxLayout({vertical: true, style_class: 'archsport-notch',
            reactive: true, can_focus: true, width: 336, height: 46,
            accessible_name: 'Archsport 경기 노치', clip_to_allocation: true});
        this._dock = new DockParticipant({id: this.uuid, actor: this._root,
            monitor: () => this._monitor(), order: 0,
            onYield: () => { this._expanded = false; this._activeAlert = null; this._render(); }});
        const toggle = () => {
            this._expanded = this._activeAlert ? false : !this._expanded;
            this._activeAlert = null;
            this._render();
        };
        this._root.connect('button-press-event', () => { toggle(); return Clutter.EVENT_STOP; });
        this._root.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                this._expanded = false; this._activeAlert = null; this._render();
                return Clutter.EVENT_STOP;
            }
            if ([Clutter.KEY_Return, Clutter.KEY_space].includes(key)) {
                toggle(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.addChrome(this._root, {affectsStruts: false, trackFullscreen: true});
        this._indicator = new PanelMenu.Button(0.0, 'Archsport');
        this._indicator.add_child(new St.Label({text: 'FCB', y_align: Clutter.ActorAlign.CENTER}));
        this._indicator.menu.addAction('노치 펼치기 / 접기', toggle);
        this._indicator.menu.addAction('Archsport 설정', () => this.openPreferences());
        this._indicator.menu.addAction('데이터 다시 연결', () => this._restartWorker());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        this._connect(Main.overview, 'showing', () => this._dock.update({visible: false}));
        this._connect(Main.overview, 'hidden', () => this._visibility());
        this._connect(Main.sessionMode, 'updated', () => this._visibility());
        this._connect(global.display, 'in-fullscreen-changed', () => this._visibility());
        this._connect(this._settings, 'changed', (_settings, key) => {
            if (DATA_KEYS.has(key)) this._restartWorker();
            else {
                this._activeAlert = null;
                this._render();
            }
        });
        this._sleepSubscription = Gio.DBus.system.signal_subscribe('org.freedesktop.login1',
            'org.freedesktop.login1.Manager', 'PrepareForSleep', '/org/freedesktop/login1',
            null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, args) => {
                if (args.deep_unpack()[0]) this._stopWorker();
                else if (this._enabled) this._restartWorker();
            });
        this._render();
        this._startWorker();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _monitor() {
        const index = this._settings.get_int('monitor-index');
        return Main.layoutManager.monitors[index] ?? Main.layoutManager.primaryMonitor;
    }

    _place() {
        if (!this._root || !this._settings) return;
        this._visibility();
    }

    _visibility() {
        if (!this._root) return;
        const match = this._payload.match;
        const allowed = this._settings.get_boolean('show-notch') && this._payload.visible !== false;
        const upcoming = match?.status !== 'scheduled' || this._settings.get_boolean('show-upcoming');
        const fullscreen = this._settings.get_boolean('hide-fullscreen') && this._monitor()?.inFullscreen;
        this._dock?.update({visible: allowed && upcoming && !Main.overview.visible &&
            !Main.sessionMode.isLocked && !fullscreen});
    }

    _label(text, style) {
        return new St.Label({text: String(text), style_class: style, x_align: Clutter.ActorAlign.CENTER});
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

    _render(incoming = null) {
        if (!this._enabled) return;
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const now = GLib.get_monotonic_time() / 1000;
        const spoiler = this._settings.get_boolean('spoiler');
        if (spoiler || !this._settings.get_boolean('expand-on-event')) this._activeAlert = null;
        else if (incoming) {
            this._activeAlert = incoming;
            this._alertDeadline = now + this._settings.get_int('event-seconds') * 1000;
        } else if (now >= this._alertDeadline) this._activeAlert = null;
        const alert = this._activeAlert;
        this._root.remove_all_children();
        const data = this._payload;
        const match = data.match;
        const source = data.mode === 'demo' ? '시연 · 실제 경기 아님' : 'API-Football';
        const score = spoiler ? '● : ●' : match ? `${match.home_score ?? '–'} : ${match.away_score ?? '–'}` : '– : –';
        let clock = match ? `${STATUS[match.status] ?? '상태 미확인'} ${match.elapsed ?? ''}${match.extra ? `+${match.extra}` : ''}${match.elapsed == null ? '' : '′'}` : '';
        if (match?.status === 'scheduled' && match.kickoff_utc) {
            clock = `${new Date(match.kickoff_utc).toLocaleString()} 시작`;
        }
        const health = data.health === 'error' ? '연결 오류 · 마지막 정보' : clock;
        let expanded = this._expanded || Boolean(alert);
        if (expanded && !this._dock.state.expanded && !this._dock.claim(alert ? 80 : 100)) {
            // A manually opened companion review owns focus; keep this update compact.
            this._expanded = false;
            expanded = false;
        }
        if (!expanded) {
            const row = new St.BoxLayout({style_class: 'archsport-compact',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            if (match) row.add_child(this._logo(match, 'home', 20));
            row.add_child(this._label(score, 'archsport-team'));
            if (match) row.add_child(this._logo(match, 'away', 20));
            row.add_child(this._label(data.mode === 'demo' ? '시연' : (health || data.message), 'archsport-live'));
            this._root.add_child(row);
        } else {
            this._root.add_child(this._label(source, 'archsport-live'));
            this._root.add_child(this._label(alert?.title ?? match?.competition ?? 'Archsport 설정에서 API 키를 입력하세요', alert ? 'archsport-alert' : 'archsport-caption'));
            const teams = new St.BoxLayout({style_class: 'archsport-compact', x_align: Clutter.ActorAlign.CENTER});
            if (match) {
                teams.add_child(this._logo(match, 'home', 32));
                teams.add_child(this._label(`${match.home} — ${match.away}`, 'archsport-team'));
                teams.add_child(this._logo(match, 'away', 32));
            }
            this._root.add_child(teams);
            this._root.add_child(this._label(score, 'archsport-score'));
            const events = match?.events ?? [];
            const latest = alert?.kind === 'score' ? events.filter(e => e.kind === 'Goal' && e.detail !== 'Missed Penalty').at(-1) : events.at(-1);
            let detail = data.health === 'error' ? data.message : health;
            if (!spoiler && alert && latest) detail = `최근 기록 ${latest.elapsed ?? ''}′ ${latest.player} · ${latest.detail}`;
            if (!spoiler && match?.home_penalties != null) detail += ` · PK ${match.home_penalties}:${match.away_penalties}`;
            this._root.add_child(this._label(detail || '수신 대기', 'archsport-caption'));
            const close = new St.Button({label: '접기', style_class: 'archsport-close', can_focus: true, x_align: Clutter.ActorAlign.CENTER});
            close.connect('clicked', () => { this._expanded = false; this._activeAlert = null; this._render(); });
            this._root.add_child(close);
        }
        const width = Math.min(expanded ? 500 : 360, (this._monitor()?.width ?? 800) - 24);
        this._root.remove_all_transitions();
        this._root.ease({width, height: expanded ? 250 : 46,
            duration: this._interface.get_boolean('enable-animations') ? 320 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._dock.update({width, height: expanded ? 250 : 46, expanded});
        this._place();
        this._root.accessible_name = `Archsport ${source}. ${match?.home ?? ''} ${score} ${match?.away ?? ''}. ${health}`;
        if (alert) this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(this._alertDeadline - now)), () => {
            this._timer = 0; this._activeAlert = null; this._expanded = false; this._render();
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
                '--poll-seconds', String(this._settings.get_int('poll-seconds')),
                '--daily-budget', String(this._settings.get_int('daily-budget'))];
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
                if (this._payload.health === 'error' && !this._payload.match) this._expanded = true;
                this._render(this._payload.alert);
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
        this._activeAlert = null;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        if (!this._enabled) return;
        this._restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._restartTimer = 0; this._startWorker(); return GLib.SOURCE_REMOVE;
        });
    }

    _workerFailed() {
        this._payload = {...this._payload, health: 'error', visible: true, message: '경기 서비스를 다시 시작합니다.'};
        this._expanded = true;
        this._render();
        this._failures++;
        this._restartWorker(Math.min(60000, 5000 * 2 ** Math.min(this._failures - 1, 4)));
    }

    disable() {
        this._enabled = false;
        this._stopWorker();
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        if (this._sleepSubscription) Gio.DBus.system.signal_unsubscribe(this._sleepSubscription);
        this._sleepSubscription = 0;
        for (const [object, id] of this._signals ?? []) object.disconnect(id);
        this._signals = [];
        this._dock?.destroy();
        this._dock = null;
        if (this._root) Main.layoutManager.removeChrome(this._root);
        this._root?.destroy();
        this._indicator?.destroy();
        this._root = this._indicator = this._settings = this._interface = this._payload = null;
    }
}
