import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const TEAMS = [['Barcelona', 529], ['Lazio', 487], ['Como', 895]];
// 'idle' only means no match is on; warnings can ride along, so it never claims '정상'.
const HEALTH = {fresh: '경기 진행 중', idle: '대기 중', loading: '연결 중', error: '오류'};
const KEYPAD = {Enter: 'Enter', Delete: 'Del', Decimal: '.', Add: '+', Subtract: '-', Multiply: '*', Divide: '/'};

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

// Gtk names keypad keys in English ('KP Enter'); only that key part is translated.
function shortcutLabel(accel) {
    const [ok, key, mods] = Gtk.accelerator_parse(accel);
    if (!ok || !key) return null;
    const label = Gtk.accelerator_get_label(key, mods), keyLabel = Gtk.accelerator_get_label(key, 0);
    const name = Gdk.keyval_name(key) ?? '';
    if (!name.startsWith('KP_') || !label.endsWith(keyLabel)) return label;
    return `${label.slice(0, label.length - keyLabel.length)}숫자패드 ${KEYPAD[name.slice(3)] ?? name.slice(3)}`;
}

function crest(extensionPath, id) {
    for (const folder of [GLib.build_filenamev([extensionPath, 'assets', 'logos']),
        GLib.build_filenamev([GLib.get_user_cache_dir(), 'archsport', 'logos'])]) {
        const path = GLib.build_filenamev([folder, `${id}.png`]);
        if (GLib.file_test(path, GLib.FileTest.IS_REGULAR))
            return new Gtk.Image({file: path, pixel_size: 24});
    }
    // No crest cached yet: keep the column, never stand in a generic emblem.
    return new Gtk.Image({pixel_size: 24});
}

export default class ArchsportPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._archsportSettings = settings;
        const page = new Adw.PreferencesPage({title: 'Archsport', icon_name: 'applications-games-symbolic'});
        window.add(page);

        // One switch per supported club replaces the comma-separated text field.
        const team = new Adw.PreferencesGroup({title: '응원 팀', description: '노치와 일정에 보여 줄 팀입니다. 한 팀 이상 켜 두세요.'});
        page.add(team);
        const teamRows = TEAMS.map(([name, id]) => {
            const row = new Adw.SwitchRow({title: name, active: settings.get_strv('watch-teams').includes(name)});
            row.add_prefix(crest(this.path, id));
            row.connect('notify::active', () => {
                const chosen = TEAMS.map(([teamName], index) => teamRows[index]?.active ? teamName : null).filter(Boolean);
                if (!chosen.length) {
                    row.active = true;
                    window.add_toast(new Adw.Toast({title: '한 팀 이상은 켜 두어야 합니다.'}));
                    return;
                }
                if (chosen.join() !== settings.get_strv('watch-teams').join()) settings.set_strv('watch-teams', chosen);
            });
            team.add(row);
            return row;
        });

        const data = new Adw.PreferencesGroup({title: '데이터', description: '일정은 football-data.org, 라이브 점수는 API-Football에서 받습니다.\n' +
            '컵 대회(코파 델 레이·코파 이탈리아 등)는 무료 일정에 없어 표시되지 않을 수 있습니다. 경기 없는 날 저녁에만 라이브 목록으로 찾아봅니다.'});
        page.add(data);
        const mode = new Adw.ComboRow({title: '데이터 모드', model: Gtk.StringList.new(['실제 경기', '시연 · 가상 경기']), selected: settings.get_string('mode') === 'demo' ? 1 : 0});
        mode.connect('notify::selected', () => settings.set_string('mode', mode.selected === 1 ? 'demo' : 'live'));
        data.add(mode);
        // Each key row says whether a key is stored, beside the field, instead of on a second row.
        const keyRow = (title, fileName) => {
            const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'archsport', fileName]);
            const row = new Adw.PasswordEntryRow({title, show_apply_button: true});
            const state = new Gtk.Label({css_classes: ['dim-label', 'caption'], valign: Gtk.Align.CENTER});
            const showState = text => { state.label = text; };
            showState(GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? '저장됨' : '필요');
            row.add_suffix(state);
            row.connect('apply', () => {
                if (!row.text.trim()) return;
                try {
                    saveSecret(path, row.text);
                    row.text = '';
                    showState('저장됨');
                    settings.set_int('key-revision', settings.get_int('key-revision') + 1);
                    window.add_toast(new Adw.Toast({title: `${title}를 저장했습니다. 바로 적용됩니다.`}));
                } catch (_error) {
                    showState('저장 실패');
                }
            });
            data.add(row);
        };
        keyRow('라이브 점수 키 (API-Football)', 'api-key');
        keyRow('일정 키 (football-data.org)', 'football-data-token');
        const health = new Adw.ActionRow({title: '서비스 상태', use_markup: false});
        const readHealth = () => {
            try {
                const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_state_dir(), 'archsport', 'health.json']));
                const [, bytes] = file.load_contents(null);
                const status = JSON.parse(new TextDecoder().decode(bytes));
                const updated = GLib.DateTime.new_from_iso8601(String(status.updated_at ?? ''), null)?.to_local().format('%H:%M');
                health.subtitle = [status.mode === 'demo' ? '시연' : HEALTH[status.health] ?? '상태 미확인',
                    status.message, updated && `마지막 갱신 ${updated}`].filter(Boolean).join(' · ');
            } catch (_error) {
                health.subtitle = '상태 정보 없음 · 확장 기능이 켜져 있는지 확인하세요.';
            }
            return GLib.SOURCE_CONTINUE;
        };
        readHealth();
        // Refreshes itself while the window is open; no manual button to remember.
        const healthTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, readHealth);
        data.add(health);
        const spin = (group, keyName, title, subtitle, lower, upper, step) => {
            const row = new Adw.SpinRow({title, subtitle, adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}), value: settings.get_int(keyName)});
            settings.bind(keyName, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        spin(data, 'poll-seconds', '경기 중 갱신 간격', '300–600초 · 짧을수록 API 사용량이 늘어납니다', 300, 600, 60);
        spin(data, 'daily-budget', '하루 API 요청 상한', '무료 요금제는 하루 100회 · 기본 90', 0, 100000, 10);

        const notch = new Adw.PreferencesGroup({title: '노치', description: '상단 패널 아래에 경기 중에만 나타납니다.'});
        page.add(notch);
        for (const [keyName, title, subtitle] of [['show-notch', '경기 중 노치 표시', ''],
            ['expand-on-event', '골·경기 상태가 바뀌면 펼치기', ''],
            ['hide-fullscreen', '전체화면에서 숨기기', ''],
            ['spoiler', '스포일러 숨기기', '점수와 득점자를 가리고 알림을 펼치지 않습니다']]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(keyName, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            notch.add(row);
        }
        spin(notch, 'event-seconds', '알림 표시 시간', '초', 2, 30, 1);
        const shortcut = new Adw.ActionRow({title: '열기/닫기 단축키', use_markup: false});
        const updateShortcut = () => {
            const labels = settings.get_strv('archsport-toggle-shortcut').map(shortcutLabel).filter(Boolean);
            shortcut.subtitle = labels.length ? labels.join(' 또는 ') : '설정되지 않음';
        };
        updateShortcut();
        notch.add(shortcut);
        const count = Gdk.Display.get_default()?.get_monitors().get_n_items() ?? 1;
        const monitors = new Adw.ComboRow({title: '표시 모니터', model: Gtk.StringList.new(['기본 모니터', ...Array.from({length: count}, (_, i) => `모니터 ${i + 1}`)]), selected: Math.min(count, settings.get_int('monitor-index') + 1)});
        monitors.connect('notify::selected', () => settings.set_int('monitor-index', monitors.selected - 1));
        notch.add(monitors);

        const handlers = [settings.connect('changed::archsport-toggle-shortcut', updateShortcut),
            settings.connect('changed::watch-teams', () => {
                const chosen = settings.get_strv('watch-teams');
                TEAMS.forEach(([name], index) => { teamRows[index].active = chosen.includes(name); });
            })];
        window.connect('close-request', () => {
            GLib.source_remove(healthTimer);
            handlers.forEach(id => settings.disconnect(id));
            return false;
        });
    }
}
