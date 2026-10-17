"""Author synthetic offline fixtures; never claim these are recorded live games."""
import copy
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    folder = root / 'data'
    folder.mkdir(exist_ok=True)
    fixture = {'fixture': {'id': 990000001, 'date': '2030-01-01T20:00:00+00:00',
                           'status': {'short': 'NS', 'elapsed': None, 'extra': None}},
               'league': {'id': 2, 'name': 'Synthetic club match — not a real fixture'},
               'teams': {'home': {'id': 529, 'name': 'Barcelona'}, 'away': {'id': 505, 'name': 'Inter'}},
               'goals': {'home': None, 'away': None}, 'score': {'penalty': {'home': None, 'away': None}}}
    from archsport.provider import normalize
    frames = []
    for phase, score, minute in [('NS', None, None), ('1H', 0, 1), ('1H', 1, 31),
                                  ('1H', 0, 32), ('1H', 1, 33), ('HT', 1, 45),
                                  ('2H', 1, 67), ('2H', 2, 68), ('FT', 2, 90)]:
        item = copy.deepcopy(fixture)
        item['fixture']['status'].update(short=phase, elapsed=minute)
        item['goals'] = {'home': score, 'away': 0 if score is not None else None}
        match = normalize(item)
        if minute:
            match['events'] = [{'kind': 'Var' if minute == 32 else 'Goal',
                                'detail': 'SYNTHETIC goal cancelled' if minute == 32 else 'SYNTHETIC event',
                                'elapsed': minute, 'extra': None, 'team': 'Barcelona', 'player': '시연 선수'}]
        frames.append({'match': match})
    frames.insert(7, {'error': '시연: 네트워크 연결 끊김'})
    (folder / 'replay-barcelona.json').write_text(json.dumps({
        'synthetic': True, 'notice': 'Invented scores and timestamps. Real club names/IDs solely for identification.',
        'frames': frames}, ensure_ascii=False, indent=2), encoding='utf-8')
    (folder / 'provider-fixture.json').write_text(json.dumps({
        'synthetic': True, 'get': 'fixtures', 'errors': [], 'paging': {'current': 1, 'total': 1},
        'response': [fixture]}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Wrote synthetic provider fixture and 10-frame replay.')


if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    main()
