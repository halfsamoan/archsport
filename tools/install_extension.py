"""Per-user Ubuntu install/upgrade with staged schema compilation and backup."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--upgrade', action='store_true', help='Back up and replace this extension only')
    args = parser.parse_args()
    if sys.platform != 'linux':
        raise SystemExit('Ubuntu GNOME에서 실행하세요. Windows에서는 web/ 시제품을 사용합니다.')
    if 'GNOME' not in os.environ.get('XDG_CURRENT_DESKTOP', '').upper():
        raise SystemExit('GNOME 데스크톱 세션에서 실행하세요.')
    if os.geteuid() == 0:
        raise SystemExit('sudo 없이 데스크톱 사용자로 실행하세요.')
    compiler = shutil.which('glib-compile-schemas')
    if not compiler:
        raise SystemExit('glib-compile-schemas가 필요합니다: sudo apt install libglib2.0-bin')
    source = Path(__file__).resolve().parents[1]
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    parent = data / 'gnome-shell/extensions'
    target = parent / 'archsport@local'
    if target.is_symlink() or (target.exists() and target.resolve().parent != parent.resolve()):
        raise SystemExit('예상하지 않은 확장 경로입니다. 기존 설치를 보존했습니다.')
    if target.exists() and not args.upgrade:
        raise SystemExit('기존 설치를 보존했습니다. 업데이트하려면 --upgrade를 사용하세요.')
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.archsport-stage-', dir=parent))
    shutil.copytree(source / 'extension', staging, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('gschemas.compiled'))
    shutil.copytree(source / 'archsport', staging / 'archsport', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(source / 'web/assets/logos', staging / 'assets/logos')
    shutil.copytree(source / 'data', staging / 'data')
    subprocess.run([compiler, '--strict', str(staging / 'schemas')], check=True)
    if target.exists():
        metadata = json.loads((target / 'metadata.json').read_text(encoding='utf-8'))
        if metadata.get('uuid') != 'archsport@local':
            raise SystemExit(f'다른 확장을 덮어쓰지 않습니다. 준비 폴더 보존: {staging}')
        subprocess.run(['gnome-extensions', 'disable', 'archsport@local'], check=False)
        backup_root = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'archsport/backups'
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = backup_root / datetime.now().strftime('extension-%Y%m%d-%H%M%S-%f')
        shutil.move(str(target), str(backup))
        print(f'이전 확장 백업: {backup}')
    staging.rename(target)
    config_dir = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'archsport'
    config_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    print(f'설치됨: {target}')
    print('로그아웃·로그인 후: gnome-extensions enable archsport@local')
    print('설정창: gnome-extensions prefs archsport@local')
    print('기본 live 모드. 키가 없으면 설정 필요 상태가 표시됩니다.')


if __name__ == '__main__':
    main()
