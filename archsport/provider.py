"""Documented API-Football v3 adapter. Personal key stays in Python."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

STATUS = {
    'TBD': 'scheduled', 'NS': 'scheduled', 'LIVE': 'live', '1H': 'live', '2H': 'live',
    'HT': 'halftime', 'BT': 'halftime', 'ET': 'extra_time', 'P': 'penalties',
    'FT': 'finished', 'AET': 'finished', 'PEN': 'finished', 'AWD': 'finished',
    'WO': 'finished', 'PST': 'postponed', 'CANC': 'cancelled',
    'SUSP': 'interrupted', 'INT': 'interrupted', 'ABD': 'abandoned',
}
ACTIVE = {'live', 'halftime', 'extra_time', 'penalties', 'interrupted'}


def seconds_until_utc_reset(now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    next_day = now.astimezone(timezone.utc).date() + timedelta(days=1)
    reset = datetime.combine(next_day, datetime.min.time(), tzinfo=timezone.utc)
    # The provider resets at 00:00 UTC; wait a few extra seconds for propagation.
    return max(1, int((reset - now.astimezone(timezone.utc)).total_seconds()) + 5)


class ProviderError(Exception):
    def __init__(self, message, retry_seconds=None, plan_restricted=False):
        super().__init__(message)
        self.retry_seconds = retry_seconds
        self.plan_restricted = plan_restricted


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
        self.context = {'upcoming': None, 'recent': [], 'recent_stats': None}
        self.live_only = False
        self.key_file = Path(config.get('key_file', '~/.config/archsport/api-key')).expanduser()
        self.key = os.environ.get('ARCHSPORT_API_KEY', '').strip()
        if not self.key:
            if self.key_file.is_file():
                self.key = self.key_file.read_text(encoding='utf-8').strip()
        if not self.key:
            raise ProviderError('API 키가 없습니다. api-key 파일을 설정하세요.')

    def get(self, endpoint, **params):
        today = datetime.now(timezone.utc).date()
        if self._quota_day != today:
            self.remaining = None
            self._quota_day = today
        if self.remaining is not None and self.remaining <= 0:
            raise ProviderError('공급사 API 일일 할당량을 모두 사용했습니다.',
                                retry_seconds=seconds_until_utc_reset())
        if not self.store.reserve_request(self.config['daily_budget']):
            raise ProviderError('설정한 일일 요청 예산에 도달했습니다.',
                                retry_seconds=seconds_until_utc_reset())
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
        if isinstance(payload, dict) and payload.get('errors'):
            errors = payload['errors']
            plan_error = errors.get('plan', '') if isinstance(errors, dict) else ''
            if 'free plan' in str(plan_error).casefold() and 'season' in str(plan_error).casefold():
                raise ProviderError('현재 무료 API 요금제에서 요청 시즌을 지원하지 않습니다. 대시보드의 허용 시즌을 확인하세요.',
                                    retry_seconds=24 * 60 * 60, plan_restricted=True)
            raise ProviderError('API가 요청을 거절했습니다. 요금제·시즌·파라미터를 확인하세요.')
        if not isinstance(payload, dict):
            raise ProviderError('API가 요청을 거절했습니다. 요금제·시즌·파라미터를 확인하세요.')
        if (payload.get('paging') or {}).get('total', 1) > 1:
            raise ProviderError('여러 페이지의 응답입니다. 조회 범위를 줄여야 합니다.')
        if not isinstance(payload.get('response'), list):
            raise ProviderError('API 데이터 목록이 없습니다.')
        return payload['response']

    def _cached_get(self, key, ttl, now, endpoint, **params):
        cached = self.store.cache_get('api:' + key)
        if isinstance(cached, dict) and now.timestamp() - cached.get('at', 0) < ttl:
            return cached.get('data', [])
        result = self.get(endpoint, **params)
        self.store.cache_set('api:' + key, {'at': now.timestamp(), 'data': result})
        return result

    def _load_context(self, now, season):
        """Load low-frequency schedule/history data without blocking live scores."""
        self.context = {'upcoming': None, 'recent': [], 'recent_stats': None}
        try:
            upcoming = self._cached_get(f'next:{self.team_id}:{season}', 6 * 3600, now,
                                        'fixtures', team=self.team_id, next=1, season=season,
                                        timezone='UTC')
            if upcoming:
                self.context['upcoming'] = normalize(upcoming[0])
        except (ProviderError, KeyError, TypeError, ValueError):
            self.warning = '다음 경기 일정을 갱신하지 못했습니다.'
        try:
            recent = self._cached_get(f'last:{self.team_id}:{season}', 12 * 3600, now,
                                      'fixtures', team=self.team_id, last=5, season=season,
                                      timezone='UTC')
            recent = [normalize(item) for item in recent if STATUS.get(
                item['fixture']['status']['short']) in ('finished', 'abandoned')]
            if not recent:
                previous_season = season - 1
                previous = self._cached_get(f'last:{self.team_id}:{previous_season}', 12 * 3600,
                                            now, 'fixtures', team=self.team_id, last=5,
                                            season=previous_season, timezone='UTC')
                recent = [normalize(item) for item in previous if STATUS.get(
                    item['fixture']['status']['short']) in ('finished', 'abandoned')]
            recent.sort(key=lambda fixture: fixture.get('kickoff_utc') or '', reverse=True)
            self.context['recent'] = recent
            if recent:
                item = recent[0]
                stats = self._cached_get(f"stats:{item['id']}", 7 * 86400, now,
                                         'fixtures/statistics', fixture=item['id'])
                wanted = {'Total Shots', 'Shots on Goal', 'Ball Possession', 'Corner Kicks'}
                values = {}
                for team in stats:
                    team_id = str((team.get('team') or {}).get('id'))
                    values[team_id] = {row.get('type'): row.get('value')
                                       for row in team.get('statistics', [])
                                       if row.get('type') in wanted}
                self.context['recent_stats'] = {
                    'fixture_id': item['id'],
                    'teams': [item.get('home', ''), item.get('away', '')],
                    'team_order': [str(item.get('home_id')), str(item.get('away_id'))],
                    'values': values, 'available': bool(values),
                }
        except (ProviderError, KeyError, TypeError, ValueError):
            self.warning = '최근 경기 통계 조회 한도 또는 연결 상태를 확인하세요.'

    def _fetch_live(self):
        self.live_only = True
        self.warning = '무료 API 요금제는 현재 시즌 일정·최근 통계를 제공하지 않습니다. 경기 중 점수만 확인합니다.'
        self.context = {'upcoming': None, 'recent': [], 'recent_stats': None, 'plan_limited': True}
        fixtures = self.get('fixtures', live='all', team=self.team_id)
        matches = [item for item in fixtures if any(
            str((item.get('teams') or {}).get(side, {}).get('id')) == str(self.team_id)
            for side in ('home', 'away'))]
        self._selected_id = None
        if not matches:
            return None
        item = matches[0]
        current = normalize(item, item.get('events'))
        self._selected_id = current['id']
        return current

    def fetch(self, now=None):
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        # API-Football identifies a season by its starting calendar year.
        season = now.year if now.month >= 7 else now.year - 1
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
        key_revision = str(max(0, int(self.config.get('key_revision', 0))))
        try:
            key_revision += ':' + str(self.key_file.stat().st_mtime_ns)
        except OSError:
            pass
        plan_cache_key = f'plan:season:{self.team_id}:{key_revision}'
        plan_cache = self.store.cache_get(plan_cache_key)
        if isinstance(plan_cache, dict) and 0 <= now.timestamp() - plan_cache.get('at', 0) < 24 * 60 * 60:
            return self._fetch_live()
        # Once selected, one fixtures?id request per poll; no date-pair per tick.
        if self._selected_id:
            fixtures = self.get('fixtures', id=self._selected_id, timezone='UTC')
        else:
            try:
                fixtures = self._cached_get(f"day:{self.team_id}:{season}:{now.date().isoformat()}", 600, now,
                                            'fixtures', team=self.team_id,
                                            date=now.date().isoformat(), season=season, timezone='UTC')
            except ProviderError as exc:
                if not exc.plan_restricted:
                    raise
                self.store.cache_set(plan_cache_key, {'at': now.timestamp()})
                return self._fetch_live()
        if not self._selected_id and now.hour < 4:
            previous = self._cached_get(f"day:{self.team_id}:{season}:{(now - timedelta(days=1)).date().isoformat()}",
                                        600, now, 'fixtures', team=self.team_id,
                                        date=(now - timedelta(days=1)).date().isoformat(),
                                        season=season, timezone='UTC')
            fixtures += [f for f in previous if STATUS.get(f['fixture']['status']['short']) in ACTIVE]
        if not fixtures:
            self._selected_id = None
            fixtures = self._cached_get(f'next:{self.team_id}:{season}', 6 * 3600, now,
                                        'fixtures', team=self.team_id, next=1, season=season,
                                        timezone='UTC')
            if not fixtures:
                self._load_context(now, season)
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
                future = self._cached_get(f'next:{self.team_id}:{season}', 6 * 3600, now,
                                          'fixtures', team=self.team_id, next=1, season=season,
                                          timezone='UTC')
                if not future:
                    self._load_context(now, season)
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
        # Score/fixture requests take priority over optional context endpoints.
        self._load_context(now, season)
        return current


class ApiFootballLive(ApiFootball):
    """Low-quota live adapter for every configured club."""
    def __init__(self, config, store, opener=urlopen):
        super().__init__(config, store, opener)
        from .teams import normalize_watch_list
        self.watched = normalize_watch_list(config.get('watch_teams', ['Barcelona', 'Lazio', 'Como']))
        self.context = {'upcoming': None, 'upcoming_matches': [], 'recent': [],
                        'recent_stats': None, 'stats_available': False}

    def fetch(self, now=None, scheduled=()):
        from .identity import match_id, same_fixture
        from .teams import TEAM_MEDIA_IDS, canonical_team, is_watched

        items = self.get('fixtures', live='all')
        matches = []
        self.warning = ''
        schedule_matches = list(scheduled or ())
        for item in items:
            normalized = normalize(item)
            if normalized['status'] not in ACTIVE or not any(
                    is_watched(normalized[side], self.watched) for side in ('home', 'away')):
                continue
            provider_id = str(normalized['id'])
            fixture = next((candidate for candidate in schedule_matches
                            if same_fixture(candidate, normalized)), None)
            original_id = provider_id
            normalized['id'] = fixture['id'] if fixture else match_id(
                normalized['home'], normalized['away'], normalized['kickoff_utc'])
            normalized['source'] = 'api-football'
            normalized['source_ids'] = {'api_football': original_id}
            if fixture:
                normalized['source_ids'].update(fixture.get('source_ids') or {})
            normalized['team_keys'] = [canonical_team(normalized['home']), canonical_team(normalized['away'])]
            for side in ('home', 'away'):
                normalized[f'{side}_id'] = normalized.get(f'{side}_id') or TEAM_MEDIA_IDS.get(
                    canonical_team(normalized[side]))

            signature = tuple(normalized.get(key) for key in
                              ('home_score', 'away_score', 'status', 'home_penalties', 'away_penalties'))
            signature_key = f'live-signature:{original_id}'
            previous_signature = self.store.cache_get(signature_key)
            signature_saved = previous_signature is None or tuple(previous_signature) == signature
            if previous_signature is not None and tuple(previous_signature) != signature:
                try:
                    events = self.get('fixtures/events', fixture=original_id)
                    normalized['events'] = normalize(item, events)['events']
                    signature_saved = True
                except ProviderError:
                    self.warning = '점수는 갱신했지만 경기 상세를 받지 못했습니다.'
            if signature_saved:
                self.store.cache_set(signature_key, signature)
            matches.append(normalized)

        order = {team: index for index, team in enumerate(self.watched)}
        matches.sort(key=lambda match: min((order.get(key, 999) for key in match['team_keys']), default=999))
        self.live_only = True
        return matches


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
