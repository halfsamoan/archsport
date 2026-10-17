"""Real provider crests: bundled known teams, lazy cached PNG for opponents."""
import os
from pathlib import Path
from urllib.request import urlopen

PNG = b'\x89PNG\r\n\x1a\n'


class LogoCache:
    def __init__(self):
        base = Path(__file__).resolve().parent.parent
        self.bundled = base / ('assets/logos' if (base / 'assets/logos').exists() else 'web/assets/logos')
        self.cache = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'archsport/logos'
        self.failed = set()

    def get(self, team_id):
        if not isinstance(team_id, int) or isinstance(team_id, bool) or team_id <= 0:
            return None
        name = f'{team_id}.png'
        for folder in (self.bundled, self.cache):
            path = folder / name
            if path.is_file():
                return str(path)
        if team_id in self.failed:
            return None
        try:
            # Build the URL from an integer; never fetch arbitrary provider/user URLs.
            with urlopen(f'https://media.api-sports.io/football/teams/{team_id}.png', timeout=5) as response:
                data = response.read(1_000_001)
            if not data.startswith(PNG) or len(data) > 1_000_000:
                raise ValueError('Invalid logo PNG')
            self.cache.mkdir(parents=True, exist_ok=True)
            temp = self.cache / f'{name}.tmp'
            temp.write_bytes(data)
            temp.replace(self.cache / name)
            return str(self.cache / name)
        except (OSError, ValueError):
            self.failed.add(team_id)
            return None

    def decorate(self, match):
        for side in ('home', 'away'):
            match[f'{side}_logo_path'] = self.get(match.get(f'{side}_id'))
        return match
