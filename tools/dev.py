"""Delegate the paired development shell to matci/tools/dev.py."""
from pathlib import Path
import os
import runpy
import sys

ARCHSPORT_ROOT = Path(__file__).resolve().parents[1]
MATCI_ROOT = Path(os.environ.get('MATCI_REPO', ARCHSPORT_ROOT.parent / 'matci')).resolve()
entry = MATCI_ROOT / 'tools/dev.py'
if not entry.is_file():
    raise SystemExit('두 확장 동시 검증에는 matci 저장소가 필요합니다. MATCI_REPO로 경로를 지정하세요.')
sys.argv = [str(entry), '--archsport-root', str(ARCHSPORT_ROOT), *sys.argv[1:]]
runpy.run_path(str(entry), run_name='__main__')
