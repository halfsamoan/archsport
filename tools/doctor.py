"""Collect portable Linux handoff diagnostics without reading secrets."""
import argparse
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path


def version(command):
    if not shutil.which(command[0]):
        return 'not installed'
    result = subprocess.run(command, text=True, capture_output=True, timeout=10)
    return (result.stdout or result.stderr).strip()[:300]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'archsport'
    installed = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'gnome-shell/extensions/archsport@local'
    report = {'os': platform.system(), 'kernel': platform.release(), 'python': platform.python_version(),
              'desktop': os.getenv('XDG_CURRENT_DESKTOP', ''), 'session': os.getenv('XDG_SESSION_TYPE', ''),
              'gnome_shell': version(['gnome-shell', '--version']),
              'gjs': version(['gjs', '--version']), 'schema_compiler': bool(shutil.which('glib-compile-schemas')),
              'extension_installed': installed.exists(), 'prefs_present': (installed / 'prefs.js').is_file(),
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
