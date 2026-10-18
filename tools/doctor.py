"""Collect portable Linux handoff diagnostics without reading secrets."""
import argparse
import json
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path


UUID = 'archsport@local'


def version(command):
    if not shutil.which(command[0]):
        return 'not installed'
    result = subprocess.run(command, text=True, capture_output=True, timeout=10)
    return (result.stdout or result.stderr).strip()[:300]


def extension_runtime(uuid=UUID):
    if not shutil.which('gnome-extensions'):
        return None, None
    try:
        result = subprocess.run(['gnome-extensions', 'info', uuid], text=True, capture_output=True,
                                timeout=5, env={**os.environ, 'LC_ALL': 'C'})
    except (OSError, subprocess.TimeoutExpired):
        return None, None
    if result.returncode != 0:
        return None, None
    version_match = re.search(r'^\s*Version:\s*(\d+)\s*$', result.stdout, re.M)
    state_match = re.search(r'^\s*State:\s*(\S+)\s*$', result.stdout, re.M)
    return (int(version_match.group(1)) if version_match else None,
            state_match.group(1) if state_match else None)


def worker_processes():
    if not shutil.which('pgrep'):
        return None
    try:
        result = subprocess.run(['pgrep', '-fc', r'python3 -u -m archsport'], text=True,
                                capture_output=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    try:
        return int(result.stdout.strip() or '0')
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'archsport'
    installed = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'gnome-shell/extensions/archsport@local'
    state_dir = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'archsport'
    data_home = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    update_staging = data_home / 'gnome-shell/extension-updates/archsport@local'
    installed_version = None
    metadata_path = installed / 'metadata.json'
    if metadata_path.is_file():
        try:
            installed_version = int(json.loads(metadata_path.read_text(encoding='utf-8')).get('version'))
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            installed_version = None
    running, extension_state = extension_runtime()
    pending_path = state_dir / 'pending-relogin.json'
    version_mismatch = (running is not None and installed_version is not None
                        and running != installed_version and extension_state == 'ACTIVE')
    pending = pending_path.is_file() or update_staging.exists() or version_mismatch
    report = {'os': platform.system(), 'kernel': platform.release(), 'python': platform.python_version(),
              'desktop': os.getenv('XDG_CURRENT_DESKTOP', ''), 'session': os.getenv('XDG_SESSION_TYPE', ''),
              'gnome_shell': version(['gnome-shell', '--version']),
              'gjs': version(['gjs', '--version']), 'schema_compiler': bool(shutil.which('glib-compile-schemas')),
              'extension_installed': installed.exists(), 'prefs_present': (installed / 'prefs.js').is_file(),
              'extension_installed_version': installed_version,
              'gnome_extension_running_version': running,
              'gnome_extension_state': extension_state,
              'pending_relogin': pending,
              'worker_processes': worker_processes(),
              'schema_compiled': (installed / 'schemas/gschemas.compiled').is_file(),
              'key_present': (config / 'api-key').is_file(),
              'api_env_present': bool(os.getenv('ARCHSPORT_API_KEY')),
              'note': 'Key contents and environment dumps are intentionally excluded. This is not a live API test.'}
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
