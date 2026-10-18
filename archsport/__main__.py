import argparse
import json
import os
import sys
import time
from pathlib import Path

from .assets import LogoCache
from .composite import CompositeProvider
from .engine import Store
from .provider import DemoProvider, ProviderError
from .service import Worker
from .teams import WATCHED_TEAMS, normalize_watch_list

DEFAULT = {'mode': 'live', 'team_name': 'Barcelona', 'team_country': 'Spain',
           'team_id': None, 'poll_seconds': 300, 'daily_budget': 90,
           'key_revision': 0,
           'watch_teams': list(WATCHED_TEAMS),
           'key_file': str(Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'archsport/api-key')}
DEFAULT['football_data_key_file'] = str(Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) /
                                        'archsport/football-data-token')


class ErrorProvider:
    def __init__(self, message):
        self.message = message

    def fetch(self):
        raise ProviderError(self.message)


def read_config(args):
    config = dict(DEFAULT)
    if args.config and args.config.exists():
        config.update(json.loads(args.config.read_text(encoding='utf-8')))
    for key in ('mode', 'team_name', 'team_country', 'poll_seconds', 'daily_budget'):
        value = getattr(args, key)
        if value is not None:
            config[key] = value
    if args.watch_teams is not None:
        config['watch_teams'] = [name.strip() for name in args.watch_teams.split(',') if name.strip()]
    config['watch_teams'] = normalize_watch_list(config.get('watch_teams'))
    config['key_revision'] = max(0, int(args.key_revision))
    if args.demo or args.replay:
        config['mode'] = 'demo'
    if config['mode'] not in ('demo', 'live'):
        raise ValueError('mode')
    config['poll_seconds'] = max(300, min(600, int(config['poll_seconds'])))
    config['daily_budget'] = max(0, int(config['daily_budget']))
    return config


def write_health(state_dir, payload):
    state_dir.mkdir(parents=True, exist_ok=True)
    temp = state_dir / 'health.json.tmp'
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    temp.replace(state_dir / 'health.json')


def extension_version():
    package_root = Path(__file__).resolve().parents[1]
    candidates = (package_root / 'metadata.json', package_root / 'extension' / 'metadata.json')
    for path in candidates:
        try:
            value = json.loads(path.read_text(encoding='utf-8')).get('version')
            if isinstance(value, int) and value > 0:
                return value
        except (OSError, ValueError, TypeError):
            continue
    return None


def acquire_worker_lock(state_dir):
    state_dir.mkdir(parents=True, exist_ok=True)
    path = state_dir / 'worker.lock'
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    os.chmod(path, 0o600)
    stream = os.fdopen(descriptor, 'r+b')
    try:
        import fcntl
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stream.close()
        return None
    except BaseException:
        stream.close()
        raise
    return stream


class ReplayProvider:
    def __init__(self, path):
        self.frames = json.loads(path.read_text(encoding='utf-8'))['frames']
        if not self.frames:
            raise ValueError('Empty replay')
        self.index = 0

    def fetch(self):
        frame = self.frames[min(self.index, len(self.frames) - 1)]
        self.index += 1
        if frame.get('error'):
            raise ProviderError(frame['error'])
        return frame.get('match')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Archsport JSON Lines sports service')
    parser.add_argument('--config', type=Path)
    parser.add_argument('--mode', choices=['live', 'demo'])
    parser.add_argument('--team-name')
    parser.add_argument('--team-country')
    parser.add_argument('--watch-teams', help='comma-separated: Barcelona,Lazio,Como')
    parser.add_argument('--poll-seconds', type=int)
    parser.add_argument('--daily-budget', type=int)
    parser.add_argument('--key-revision', type=int, default=0)
    parser.add_argument('--ui-version', type=int)
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--replay', type=Path)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    try:
        config = read_config(args)
    except (OSError, ValueError, TypeError):
        print(json.dumps({'health': 'error', 'message': '설정 JSON 또는 값이 올바르지 않습니다.'}, ensure_ascii=False), flush=True)
        return 2
    state_dir = args.state_dir or (Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'archsport')
    parent_pid = os.getppid()
    worker_lock = None
    store = None
    package_version = extension_version()
    version_mismatch = args.ui_version is not None and package_version is not None and args.ui_version != package_version
    try:
        if config['mode'] != 'demo':
            worker_lock = acquire_worker_lock(state_dir)
            if worker_lock is None:
                print(json.dumps({'health': 'error', 'code': 'WORKER_ALREADY_RUNNING',
                                  'message': '다른 Archsport worker가 실행 중입니다 · 확장을 끈 뒤 CLI를 사용하세요'},
                                 ensure_ascii=False), flush=True)
                return 3
        store = Store(':memory:' if config['mode'] == 'demo' else state_dir / 'state.db')
        try:
            provider = ReplayProvider(args.replay) if args.replay else DemoProvider() if config['mode'] == 'demo' else CompositeProvider(config, store)
        except ProviderError as exc:
            provider = ErrorProvider(str(exc))
        except (OSError, ValueError, TypeError):
            provider = ErrorProvider('키 파일 또는 replay 데이터를 읽을 수 없습니다. 파일과 권한을 확인하세요.')
        worker = Worker(config, store, provider, LogoCache())
        while True:
            if not args.once and os.getppid() != parent_pid:
                return 0
            payload = worker.poll()
            if version_mismatch:
                payload['ui_version_mismatch'] = {'ui': args.ui_version, 'package': package_version}
                payload['message'] = '확장 버전 불일치 · 로그아웃 후 다시 로그인하세요'
            write_health(state_dir, payload)
            print(json.dumps(payload, ensure_ascii=False), flush=True)
            if args.once:
                return 1 if payload['health'] == 'error' else 0
            deadline = time.monotonic() + payload['next_poll_seconds']
            last_wall, last_mono = time.time(), time.monotonic()
            while time.monotonic() < deadline:
                time.sleep(min(5, max(0, deadline - time.monotonic())))
                if os.getppid() != parent_pid:
                    return 0
                wall, mono = time.time(), time.monotonic()
                if abs((wall - last_wall) - (mono - last_mono)) > 5:
                    worker.first = True
                    break
                last_wall, last_mono = wall, mono
    except (KeyboardInterrupt, BrokenPipeError):
        return 0
    finally:
        if store is not None:
            store.close()
        if worker_lock is not None:
            worker_lock.close()


if __name__ == '__main__':
    sys.exit(main())
