import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function saveSecret(path, value) {
    const directoryPath = GLib.path_get_dirname(path);
    GLib.mkdir_with_parents(directoryPath, 0o700);
    Gio.File.new_for_path(directoryPath).set_attribute_uint32('unix::mode', 0o700,
        Gio.FileQueryInfoFlags.NONE, null);
    const file = Gio.File.new_for_path(path);
    file.replace_contents(new TextEncoder().encode(value.trim()), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
}

export default class ArchsportPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._archsportSettings = settings;
        const page = new Adw.PreferencesPage({title: 'Archsport', icon_name: 'applications-games-symbolic'});
        window.add(page);
        const team = new Adw.PreferencesGroup({title: '관심 팀', description: 'Barcelona, Lazio, Como 중 쉼표로 구분해 선택합니다.'});
        page.add(team);
        const watchedTeams = new Adw.EntryRow({title: '팀', text: settings.get_strv('watch-teams').join(', '), show_apply_button: true});
        const teamState = new Adw.ActionRow({title: '지원 팀', subtitle: 'Barcelona · Lazio · Como'});
        watchedTeams.connect('apply', () => {
            const allowed = new Map([['barcelona', 'Barcelona'], ['lazio', 'Lazio'], ['como', 'Como']]);
            const selected = watchedTeams.text.split(',').map(name => name.trim().toLowerCase()).filter(Boolean);
            if (!selected.length || selected.some(name => !allowed.has(name))) {
                teamState.subtitle = 'Barcelona, Lazio, Como 중 한 팀 이상 입력하세요.';
                return;
            }
            settings.set_strv('watch-teams', [...new Set(selected.map(name => allowed.get(name)))]);
            teamState.subtitle = '저장됨 · 세 팀 설정 적용';
        });
        team.add(watchedTeams);
        team.add(teamState);
        const data = new Adw.PreferencesGroup({title: '데이터', description: '일정: football-data.org · 라이브: API-Football'});
        page.add(data);
        const mode = new Adw.ComboRow({title: '데이터 모드', model: Gtk.StringList.new(['실제 경기', '시연 · 가상 경기']), selected: settings.get_string('mode') === 'demo' ? 1 : 0});
        mode.connect('notify::selected', () => settings.set_string('mode', mode.selected === 1 ? 'demo' : 'live'));
        data.add(mode);
        const keyPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'archsport', 'api-key']);
        const key = new Adw.PasswordEntryRow({title: 'API-Football 키 · 입력 후 적용', show_apply_button: true});
        const keyState = new Adw.ActionRow({title: 'API 키', subtitle: GLib.file_test(keyPath, GLib.FileTest.IS_REGULAR) ? '저장된 키 있음' : '아직 저장하지 않음'});
        key.connect('apply', () => {
            if (!key.text.trim()) return;
            try {
                saveSecret(keyPath, key.text);
                key.text = '';
                keyState.subtitle = '저장 완료 · 확장 기능에 바로 적용됨';
                settings.set_int('key-revision', settings.get_int('key-revision') + 1);
            } catch (_error) { keyState.subtitle = '키 파일을 저장하지 못했습니다.'; }
        });
        data.add(key);
        data.add(keyState);
        const schedulePath = GLib.build_filenamev([GLib.get_user_config_dir(), 'archsport', 'football-data-token']);
        const scheduleKey = new Adw.PasswordEntryRow({title: 'football-data.org 일정 키 · 입력 후 적용', show_apply_button: true});
        const scheduleKeyState = new Adw.ActionRow({title: '일정 API 키', subtitle: GLib.file_test(schedulePath, GLib.FileTest.IS_REGULAR) ? '저장된 키 있음' : '아직 저장하지 않음'});
        scheduleKey.connect('apply', () => {
            if (!scheduleKey.text.trim()) return;
            try {
                saveSecret(schedulePath, scheduleKey.text);
                scheduleKey.text = '';
                scheduleKeyState.subtitle = '저장 완료 · 확장 기능에 바로 적용됨';
                settings.set_int('key-revision', settings.get_int('key-revision') + 1);
            } catch (_error) { scheduleKeyState.subtitle = '키 파일을 저장하지 못했습니다.'; }
        });
        data.add(scheduleKey);
        data.add(scheduleKeyState);
        const health = new Adw.ActionRow({title: '서비스 상태', subtitle: '상태 새로고침을 누르세요.'});
        const refresh = new Gtk.Button({label: '상태 새로고침', valign: Gtk.Align.CENTER});
        const readHealth = () => {
            try {
                const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_state_dir(), 'archsport', 'health.json']));
                const [, bytes] = file.load_contents(null);
                const status = JSON.parse(new TextDecoder().decode(bytes));
                health.subtitle = `${status.mode === 'demo' ? '시연' : '실제 데이터'} · ${status.health} · ${status.message || status.updated_at || '수신 대기'}`;
            } catch (_error) { health.subtitle = '서비스 상태 없음 · 확장 기능을 켜세요.'; }
        };
        refresh.connect('clicked', readHealth);
        health.add_suffix(refresh);
        data.add(health);
        readHealth();
        const spin = (group, keyName, title, lower, upper, step) => {
            const row = new Adw.SpinRow({title, adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}), value: settings.get_int(keyName)});
            settings.bind(keyName, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        spin(data, 'poll-seconds', '경기 중 최소 업데이트 간격 · 초', 300, 600, 60);
        spin(data, 'daily-budget', '일일 API 요청 상한 · 무료 기본 90', 0, 100000, 10);
        const notch = new Adw.PreferencesGroup({title: '노치', description: 'ASUS 화면의 GNOME 상단 패널 아래에 표시합니다.'});
        page.add(notch);
        for (const [keyName, title] of [['show-notch', '경기 중 노치 표시'], ['expand-on-event', '골·정정·경기 상태 변경 시 펼치기'], ['hide-fullscreen', '전체화면에서 숨기기'], ['spoiler', '스포일러 숨기기']]) {
            const row = new Adw.SwitchRow({title});
            settings.bind(keyName, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            notch.add(row);
        }
        spin(notch, 'event-seconds', '알림 유지 시간 · 초', 2, 30, 1);
        const count = Gdk.Display.get_default()?.get_monitors().get_n_items() ?? 1;
        const monitors = new Adw.ComboRow({title: '표시 모니터', model: Gtk.StringList.new(['기본 모니터', ...Array.from({length: count}, (_, i) => `모니터 ${i + 1}`)]), selected: Math.min(count, settings.get_int('monitor-index') + 1)});
        monitors.connect('notify::selected', () => settings.set_int('monitor-index', monitors.selected - 1));
        notch.add(monitors);
    }
}
