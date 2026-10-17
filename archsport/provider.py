"""Documented API-Football v3 adapter. Personal key stays in Python."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

STATUS = {
    'TBD': 'scheduled', 'NS': 'scheduled', '1H': 'live', '2H': 'live',
    'HT': 'halftime', 'BT': 'halftime', 'ET': 'extra_time', 'P': 'penalties',
    'FT': 'finished', 'AET': 'finished', 'PEN': 'finished', 'AWD': 'finished',
    'WO': 'finished', 'PST': 'postponed', 'CANC': 'cancelled',
    'SUSP': 'interrupted', 'INT': 'interrupted', 'ABD': 'abandoned',
}
ACTIVE = {'live', 'halftime', 'extra_time', 'penalties', 'interrupted'}


class ProviderError(Exception):
    pass


def normalize(item, events=None):
    fixture = item['fixture']
    status = fixture['status']
    goals = item.get('goals') or {}
    penalty = (item.get('score') or {}).get('penalty') or {}
    normalized_events = []
    for event in events or []:
        normalized_events.append({
            'kind': event.get('type', ''), 'detail': event.get('detail', ''),
            'elapsed': (event.get('time') or {}).get('elapsed'),
            'extra': (event.get('time') or {}).get('extra'),
            'player': (event.get('player') or {}).get('name') or '',
            'team': (event.get('team') or {}).get('name') or '',
        })
    return {
        'id': str(fixture['id']), 'home': item['teams']['home']['name'],
        'away': item['teams']['away']['name'],
        'home_id': item['teams']['home'].get('id'), 'away_id': item['teams']['away'].get('id'),
        'home_score': goals.get('home'), 'away_score': goals.get('away'),
        'home_penalties': penalty.get('home'), 'away_penalties': penalty.get('away'),
        'status': STATUS.get(status.get('short'), 'unknown'),
        'provider_status': status.get('short', ''), 'elapsed': status.get('elapsed'),
        'extra': status.get('extra'), 'kickoff_utc': fixture['date'],
        'competition': item['league']['name'], 'events': normalized_events,
    }


class ApiFootball:
    def __init__(self, config, store, opener=urlopen):
        self.config, self.store, self.opener = config, store, opener
        self.team_id = config.get('team_id')
        self.remaining = None
        self._quota_day = datetime.now(timezone.utc).date()
        self._selected_id = None
        self._events = {}
        self._signatures = {}
        self._pending_events = set()
        self.warning = ''
        self.key = os.environ.get('ARCHSPORT_API_KEY', '').strip()
        if not self.key:
            path = Path(config.get('key_file', '~/.config/archsport/api-key')).expanduser()
            if path.is_file():
                self.key = path.read_text(encoding='utf-8').strip()
        if not self.key:
            raise ProviderError('API 키가 없습니다. api-key 파일을 설정하세요.')

    def get(self, endpoint, **params):
        today = datetime.now(timezone.utc).date()
        if self._quota_day != today:
            self.remaining = None
            self._quota_day = today
        if self.remaining is not None and self.remaining <= 0:
            raise ProviderError('공급사 API 일일 할당량을 모두 사용했습니다.')
        if not self.store.reserve_request(self.config['daily_budget']):
            raise ProviderError('설정한 일일 요청 예산에 도달했습니다.')
        request = Request('https://v3.football.api-sports.io/' + endpoint + '?' + urlencode(params),
                          headers={'x-apisports-key': self.key, 'Accept': 'application/json'})
        try:
            with self.opener(request, timeout=12) as response:
                remaining = response.headers.get('x-ratelimit-requests-remaining')
                if remaining is not None:
                    self.remaining = int(remaining)
                raw = response.read(3_000_001)
                if len(raw) > 3_000_000:
                    raise ProviderError('API 응답이 허용 크기를 넘었습니다.')
                payload = json.loads(raw)
        except HTTPError as exc:
            raise ProviderError(f'API HTTP {exc.code}: 키·할당량·연결을 확인하세요.') from None
        except (URLError, TimeoutError, OSError):
            raise ProviderError('데이터 서버에 연결할 수 없습니다. 다시 시도합니다.') from None
        except (ValueError, TypeError):
            raise ProviderError('API 응답 형식이 올바르지 않습니다.') from None
        if not isinstance(payload, dict) or payload.get('errors'):
            raise ProviderError('API가 요청을 거절했습니다. 요금제·시즌·파라미터를 확인하세요.')
        if (payload.get('paging') or {}).get('total', 1) > 1:
            raise ProviderError('여러 페이지의 응답입니다. 조회 범위를 줄여야 합니다.')
        if not isinstance(payload.get('response'), list):
            raise ProviderError('API 데이터 목록이 없습니다.')
        return payload['response']

    def fetch(self, now=None):
        now = now or datetime.now(timezone.utc)
        self.warning = ''
        cache_key = 'team:' + self.config['team_name'].casefold() + ':' + self.config['team_country'].casefold()
        if self.team_id is None:
            self.team_id = self.store.cache_get(cache_key)
        if self.team_id is None:
            results = self.get('teams', search=self.config['team_name'])
            matches = [r['team'] for r in results
                       if r['team']['name'].casefold() == self.config['team_name'].casefold()
                       and r['team'].get('country') == self.config['team_country']]
            if len(matches) != 1:
                raise ProviderError('팀을 하나로 확정할 수 없습니다. config의 team_id를 지정하세요.')
            self.team_id = matches[0]['id']
            self.store.cache_set(cache_key, self.team_id)
        # Once selected, one fixtures?id request per poll; no date-pair per tick.
        if self._selected_id:
            fixtures = self.get('fixtures', id=self._selected_id, timezone='UTC')
        else:
            fixtures = self.get('fixtures', team=self.team_id, date=now.date().isoformat(), timezone='UTC')
        if not self._selected_id and now.hour < 4:
            previous = self.get('fixtures', team=self.team_id,
                                date=(now - timedelta(days=1)).date().isoformat(), timezone='UTC')
            fixtures += [f for f in previous if STATUS.get(f['fixture']['status']['short']) in ACTIVE]
        if not fixtures:
            self._selected_id = None
            fixtures = self.get('fixtures', team=self.team_id, next=1, timezone='UTC')
            if not fixtures:
                return None
        def sort_key(item):
            status = STATUS.get(item['fixture']['status']['short'])
            kickoff = datetime.fromisoformat(item['fixture']['date'].replace('Z', '+00:00'))
            rank = 0 if status in ACTIVE else 1 if status == 'scheduled' else 2
            return (rank, abs((kickoff - now).total_seconds()))
        item = min(fixtures, key=sort_key)
        current = normalize(item)
        identifier = current['id']
        self._selected_id = identifier
        if current['status'] == 'finished':
            key = f'finished:{identifier}'
            finished_at = self.store.cache_get(key)
            if finished_at is None:
                finished_at = now.timestamp()
                self.store.cache_set(key, finished_at)
            current['finished_at'] = finished_at
            if now.timestamp() - finished_at >= 300:
                self._selected_id = None
                future = self.get('fixtures', team=self.team_id, next=1, timezone='UTC')
                if not future:
                    return None
                item = future[0]
                current = normalize(item)
                identifier = current['id']
                self._selected_id = identifier
        elif current['status'] not in ACTIVE and current['status'] != 'scheduled':
            self._selected_id = None
        signature = tuple(current.get(k) for k in ('home_score', 'away_score', 'status', 'home_penalties', 'away_penalties'))
        previous_signature = self._signatures.get(identifier)
        # First snapshot establishes a baseline. Fetch events only for later changes.
        if previous_signature is not None and signature != previous_signature:
            self._pending_events.add(identifier)
        self._signatures[identifier] = signature
        if identifier in self._pending_events:
            try:
                events = self.get('fixtures/events', fixture=identifier)
                self._events[identifier] = normalize(item, events)['events']
                self._pending_events.discard(identifier)
            except ProviderError:
                # A missing scorer must never discard an already received score.
                self._events[identifier] = []
                self.warning = '점수는 갱신했지만 경기 상세를 받지 못했습니다.'
        current['events'] = self._events.get(identifier, [])
        return current


class DemoProvider:
    def __init__(self):
        self.tick = 0

    def fetch(self):
        # Intentionally fictional: never label these fixtures as real live data.
        phase = min(self.tick // 3, 3)
        self.tick += 1
        score = [1, 2, 1, 2][phase]
        return {'id': 'demo-barcelona', 'home': 'Barcelona', 'away': 'Inter',
                'home_id': 529, 'away_id': 505,
                'home_score': score, 'away_score': 1, 'home_penalties': None,
                'away_penalties': None, 'status': 'live', 'provider_status': 'DEMO',
                'elapsed': 67 + phase, 'extra': None, 'kickoff_utc': None,
                'competition': '시연 경기 · 실제 일정 아님',
                'events': [{'kind': 'Goal' if phase != 2 else 'Var',
                            'detail': '가상 경기 상황', 'elapsed': 67 + phase,
                            'player': '시연 선수', 'team': 'Barcelona'}]}
