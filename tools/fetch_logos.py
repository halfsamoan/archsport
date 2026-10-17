"""Refresh the two reference club crests from the documented provider media API."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


def main():
    folder = Path(__file__).resolve().parents[1] / 'web/assets/logos'
    folder.mkdir(parents=True, exist_ok=True)
    sources = []
    for identifier, name in ((529, 'FC Barcelona'), (505, 'Inter')):
        url = f'https://media.api-sports.io/football/teams/{identifier}.png'
        with urlopen(url, timeout=20) as response:
            data = response.read(1_000_001)
        if not data.startswith(b'\x89PNG\r\n\x1a\n') or len(data) > 1_000_000:
            raise ValueError('Expected a bounded PNG')
        path = folder / f'{identifier}.png'
        path.write_bytes(data)
        sources.append({'team': name, 'provider_id': identifier, 'url': url,
                        'file': path.name, 'sha256': hashlib.sha256(data).hexdigest()})
    (folder / 'manifest.json').write_text(json.dumps({
        'retrieved_at': datetime.now(timezone.utc).isoformat(),
        'documentation': 'https://api-sports.io/documentation/football/v3',
        'notice': 'Club marks belong to their respective rights holders. Included as requested for personal match identification; no trademark ownership or blanket commercial license is asserted.',
        'logos': sources}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Saved 2 original provider PNGs and source/hash manifest.')


if __name__ == '__main__':
    main()
