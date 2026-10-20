"""Check paired design sources locally or against the peer GitHub branch."""

import os
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PEER = 'matci' if ROOT.name == 'archsport' else 'archsport'
OWNER = 'halfsamoan'
FILES = (
    'docs/design/design-tokens.json',
    'extension/designTokens.js',
    'extension/dockModel.js',
    'extension/notchDock.js',
    'extension/notchSurface.js',
)


def _branch_name():
    branch = os.environ.get('GITHUB_HEAD_REF') or os.environ.get('GITHUB_REF_NAME')
    if branch:
        return branch
    result = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', '--abbrev-ref', 'HEAD'],
                            capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else 'main'


def _remote_branch_exists(branch):
    url = f'https://api.github.com/repos/{OWNER}/{PEER}/branches/{quote(branch, safe="")}'
    request = Request(url, headers={'Accept': 'application/vnd.github+json',
                                    'User-Agent': 'paired-design-check'})
    try:
        with urlopen(request, timeout=15):
            return True
    except HTTPError as error:
        if error.code == 404:
            return False
        raise


def _remote_files(branch):
    files = {}
    for relative in FILES:
        url = (f'https://raw.githubusercontent.com/{OWNER}/{PEER}/'
               f'{quote(branch, safe="/")}/{relative}')
        with urlopen(url, timeout=15) as response:
            files[relative] = response.read()
    return files


def _compare(expected, source, *, warning_only=False):
    mismatches = [name for name in FILES if (ROOT / name).read_bytes() != expected[name]]
    if not mismatches:
        print(f'Shared design files match byte-for-byte ({source})')
        return 0
    message = f'Shared design files differ from {source}: {", ".join(mismatches)}'
    if warning_only:
        print(f'WARNING: {message}')
        return 0
    print(message)
    return 1


def main() -> int:
    sibling = ROOT.parent / PEER
    if all((sibling / name).is_file() for name in FILES):
        expected = {name: (sibling / name).read_bytes() for name in FILES}
        return _compare(expected, str(sibling))

    branch = _branch_name()
    if _remote_branch_exists(branch):
        return _compare(_remote_files(branch), f'{PEER}:{branch}')
    return _compare(_remote_files('main'), f'{PEER}:main (same-name peer branch absent)',
                    warning_only=True)


if __name__ == '__main__':
    raise SystemExit(main())
