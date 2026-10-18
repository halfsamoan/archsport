import argparse
import json
import os
import sys
import time
from pathlib import Path

from .assets import LogoCache
from .engine import Store
from .provider import ApiFootball, DemoProvider, ProviderError
from .service import Worker

DEFAULT = {'mode': 'live', 'team_name': 'Barcelona', 'team_country': 'Spain',
           'team_id': None, 'poll_seconds': 120, 'daily_budget': 90,
           'key_file': str(Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'archsport/api-key')}


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
    if args.demo or args.replay:
        config['mode'] = 'demo'
    if config['mode'] not in ('demo', 'live'):
        raise ValueError('mode')
    config['poll_seconds'] = max(60, min(300, int(config['poll_seconds'])))
    config['daily_budget'] = max(0, int(config['daily_budget']))
    return config


def write_health(state_dir, payload):
    state_dir.mkdir(parents=True, exist_ok=True)
    temp = state_dir / 'health.json.tmp'
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    temp.replace(state_dir / 'health.json')


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
    parser.add_argument('--poll-seconds', type=int)
    parser.add_argument('--daily-budget', type=int)
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--replay', type=Path)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    try:
        config = read_config(args)
    except (OSError, ValueError, TypeError):
        print(json.dumps({'health': 'error', 'message': '설정 JSON 또는 값이 올바르지 않습니다.'}, ensure_ascii=False), flush=True)
        return 2
    state_dir = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'archsport'
    store = Store(':memory:' if config['mode'] == 'demo' else state_dir / 'state.db')
    try:
        try:
            provider = ReplayProvider(args.replay) if args.replay else DemoProvider() if config['mode'] == 'demo' else ApiFootball(config, store)
        except ProviderError as exc:
            provider = ErrorProvider(str(exc))
        except (OSError, ValueError, TypeError):
            provider = ErrorProvider('키 파일 또는 replay 데이터를 읽을 수 없습니다. 파일과 권한을 확인하세요.')
        worker = Worker(config, store, provider, LogoCache())
        while True:
            payload = worker.poll()
            write_health(state_dir, payload)
            print(json.dumps(payload, ensure_ascii=False), flush=True)
            if args.once:
                return 1 if payload['health'] == 'error' else 0
            deadline = time.monotonic() + payload['next_poll_seconds']
            last_wall, last_mono = time.time(), time.monotonic()
            while time.monotonic() < deadline:
                time.sleep(min(5, max(0, deadline - time.monotonic())))
                wall, mono = time.time(), time.monotonic()
                if abs((wall - last_wall) - (mono - last_mono)) > 5:
                    worker.first = True
                    break
                last_wall, last_mono = wall, mono
    except (KeyboardInterrupt, BrokenPipeError):
        return 0
    finally:
        store.close()


if __name__ == '__main__':
    sys.exit(main())
