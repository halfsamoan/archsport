"""football-data.org free-tier fixture schedule adapter."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .identity import match_id
from .provider import ProviderError
from .teams import TEAM_MEDIA_IDS, canonical_team, is_watched, normalize_watch_list


COMPETITIONS = ('PD', 'SA', 'CL')
WINDOW_DAYS = 7
CACHE_SECONDS = 6 * 60 * 60
LOOKBACK_DAYS = 28
LOOKAHEAD_DAYS = 28
# The free feed can briefly serve an old copy of a fixture list (2026-10-21: PSG–Barcelona
# vanished hours before kickoff, so neither the 2 h reminder nor the live probe ran). A watched
# fixture seen once stays scheduled from KNOWN_BEFORE before kickoff until KNOWN_AFTER after it.
KNOWN_KEY = 'schedule-known:football-data'
KNOWN_BEFORE = timedelta(days=2)
KNOWN_AFTER = timedelta(hours=3)
# After a watched match should have ended, re-read its window until the result arrives.
RESULT_WAIT_FROM = timedelta(minutes=105)
RESULT_WAIT_UNTIL = timedelta(hours=12)
RESULT_RETRY_SECONDS = 30 * 60
SETTLED = {'finished', 'postponed', 'cancelled', 'abandoned'}


def date_windows(today, lookback=LOOKBACK_DAYS, lookahead=LOOKAHEAD_DAYS):
    start = today - timedelta(days=lookback)
    end = today + timedelta(days=lookahead)
    # Keep cache keys stable during a calendar week. football-data.org accepts
    # an exclusive dateTo, so the caller adds one day for each inclusive week.
    start -= timedelta(days=start.weekday())
    end += timedelta(days=6 - end.weekday())
    result = []
    cursor = start
    while cursor <= end:
        last = cursor + timedelta(days=WINDOW_DAYS - 1)
        result.append((cursor, last))
        cursor = last + timedelta(days=1)
    return result


def normalize_match(item):
    home = item.get('homeTeam') or {}
    away = item.get('awayTeam') or {}
    kickoff = item.get('utcDate')
    if not home.get('name') or not away.get('name') or not kickoff:
        raise ValueError('incomplete fixture')
    status_value = item.get('status')
    status = {
        'SCHEDULED': 'scheduled', 'TIMED': 'scheduled', 'IN_PLAY': 'live', 'LIVE': 'live',
        'PAUSED': 'halftime', 'FINISHED': 'finished', 'SUSPENDED': 'interrupted',
        'POSTPONED': 'postponed', 'CANCELLED': 'cancelled', 'AWARDED': 'finished',
    }.get(status_value, 'unknown')
    full_time = (item.get('score') or {}).get('fullTime') or {}
    home_score, away_score = full_time.get('home'), full_time.get('away')
    if status != 'finished':
        home_score = away_score = None
    competition = item.get('competition') or {}
    source_id = str(item.get('id', ''))
    identifier = match_id(home['name'], away['name'], kickoff)
    home_key, away_key = canonical_team(home['name']), canonical_team(away['name'])
    return {
        'id': identifier, 'home': home['name'], 'away': away['name'],
        # Only API-Football IDs may be passed to its media host.
        'home_id': TEAM_MEDIA_IDS.get(home_key), 'away_id': TEAM_MEDIA_IDS.get(away_key),
        'home_score': home_score, 'away_score': away_score,
        'home_penalties': None, 'away_penalties': None,
        'status': status, 'provider_status': status_value or '', 'elapsed': None, 'extra': None,
        'kickoff_utc': kickoff,
        'competition': competition.get('name', ''), 'competition_code': competition.get('code', ''),
        'events': [], 'source': 'football-data.org', 'source_ids': {'football_data': source_id},
        'team_keys': [home_key, away_key],
    }


class FootballDataSchedule:
    def __init__(self, config, store, opener=urlopen):
        self.config, self.store, self.opener = config, store, opener
        self.key_file = Path(config.get('football_data_key_file',
            '~/.config/archsport/football-data-token')).expanduser()
        self.watched = normalize_watch_list(config.get('watch_teams', ['barcelona', 'lazio', 'como']))
        self.matches = []
        self.warning = ''
        self.context = {'upcoming': None, 'upcoming_matches': [], 'recent': [],
                        'recent_stats': None, 'schedule_source': 'football-data.org',
                        'schedule_delayed': True, 'stats_available': False}

    def _token(self):
        try:
            value = self.key_file.read_text(encoding='utf-8').strip()
        except OSError:
            value = ''
        if not value:
            raise ProviderError('football-data.org 일정 키가 없습니다. 설정에서 일정 키를 입력하세요.')
        return value

    def _get(self, start, end, now):
        token = self._token()
        rate_retry = self.store.reserve_rate_limit('football-data', 10, 60, now.timestamp())
        if rate_retry:
            raise ProviderError('football-data.org 분당 요청 한도에 도달했습니다.', retry_seconds=rate_retry)
        params = {'competitions': ','.join(COMPETITIONS),
                  'dateFrom': start.isoformat(),
                  # football-data.org treats dateTo as exclusive. Keep our
                  # locally inclusive seven-day window intact at the API.
                  'dateTo': (end + timedelta(days=1)).isoformat()}
        request = Request('https://api.football-data.org/v4/matches?' + urlencode(params),
                          headers={'X-Auth-Token': token, 'Accept': 'application/json',
                                   'User-Agent': 'Archsport/1.0'})
        try:
            with self.opener(request, timeout=15) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ProviderError('football-data.org 일정 응답이 허용 크기를 넘었습니다.')
                payload = json.loads(raw.decode('utf-8'))
        except HTTPError as exc:
            if exc.code == 429:
                raise ProviderError('football-data.org 요청 한도입니다.', retry_seconds=60) from None
            message = 'football-data.org 인증을 확인하세요.' if exc.code in (401, 403) else \
                f'football-data.org HTTP {exc.code} 응답입니다.'
            raise ProviderError(message) from None
        except (URLError, TimeoutError, OSError):
            raise ProviderError('football-data.org 일정 서버에 연결할 수 없습니다.') from None
        except (UnicodeError, ValueError):
            raise ProviderError('football-data.org 응답 형식이 올바르지 않습니다.') from None
        matches = payload.get('matches') if isinstance(payload, dict) else None
        if not isinstance(matches, list):
            raise ProviderError('football-data.org 경기 목록을 읽을 수 없습니다.')
        return matches

    def _watched_rows(self, rows):
        for row in rows:
            try:
                item = normalize_match(row)
            except (TypeError, ValueError, KeyError):
                continue
            if item['competition_code'] in COMPETITIONS and any(
                    is_watched(side, self.watched) for side in (item['home'], item['away'])):
                yield item

    def _awaiting_result(self, rows, now):
        for item in self._watched_rows(rows):
            kickoff = datetime.fromisoformat(item['kickoff_utc'].replace('Z', '+00:00'))
            if item['status'] not in SETTLED and RESULT_WAIT_FROM <= now - kickoff <= RESULT_WAIT_UNTIL:
                return True
        return False

    def _keep_known(self, normalized, now):
        present = {item['id'] for item in normalized}
        known = self.store.cache_get(KNOWN_KEY, {})
        if not isinstance(known, dict):
            known = {}
        kept = []
        for identifier, item in known.items():
            try:
                kickoff = datetime.fromisoformat(item['kickoff_utc'].replace('Z', '+00:00'))
            except (TypeError, ValueError, KeyError, AttributeError):
                continue
            if identifier not in present and -KNOWN_AFTER <= kickoff - now <= KNOWN_BEFORE:
                kept.append({**item, 'schedule_missing': True})
        remember = {}
        for item in normalized + kept:
            kickoff = datetime.fromisoformat(item['kickoff_utc'].replace('Z', '+00:00'))
            if item['status'] == 'scheduled' and -KNOWN_AFTER <= kickoff - now <= KNOWN_BEFORE:
                remember[item['id']] = {key: value for key, value in item.items() if key != 'schedule_missing'}
        self.store.cache_set(KNOWN_KEY, remember)
        return normalized + kept

    def fetch_context(self, now=None):
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        self.warning = ''
        seen = {}
        latest_cache_time = 0
        fetch_failed = False
        windows = date_windows(now.astimezone(timezone.utc).date())
        for start, end in windows:
            cache_key = f'football-data:{start.isoformat()}:{end.isoformat()}'
            cached = self.store.cache_get(cache_key)
            age = now.timestamp() - cached.get('at', 0) if isinstance(cached, dict) else -1
            is_fresh = 0 <= age < CACHE_SECONDS and not (
                age >= RESULT_RETRY_SECONDS and self._awaiting_result(cached.get('matches', []), now))
            if is_fresh:
                rows = cached.get('matches', [])
                latest_cache_time = max(latest_cache_time, cached.get('at', 0))
            else:
                try:
                    rows = self._get(start, end, now)
                    self.store.cache_set(cache_key, {'at': now.timestamp(), 'matches': rows})
                    latest_cache_time = max(latest_cache_time, now.timestamp())
                except ProviderError as exc:
                    fetch_failed = True
                    if isinstance(cached, dict) and isinstance(cached.get('matches'), list):
                        rows = cached['matches']
                        self.warning = '일정 연결 오류 · 마지막 저장 일정을 표시합니다.'
                        latest_cache_time = max(latest_cache_time, cached.get('at', 0))
                    else:
                        rows = []
                        self.warning = str(exc)
                        break
            for row in rows:
                source_id = str(row.get('id', ''))
                if source_id:
                    seen[source_id] = row
        # A partial/failed refresh must not discard old rows that could still
        # support the next outage fallback. Successful weekly windows remain
        # on disk for the rest of the week and are pruned after a full refresh.
        if not fetch_failed:
            self.store.cache_prune('football-data:', [f'football-data:{start.isoformat()}:{end.isoformat()}'
                                                      for start, end in windows])

        normalized = []
        for row in seen.values():
            try:
                item = normalize_match(row)
            except (TypeError, ValueError, KeyError):
                continue
            if item['competition_code'] not in COMPETITIONS:
                continue
            if not any(is_watched(side, self.watched) for side in (item['home'], item['away'])):
                continue
            normalized.append(item)
        normalized = self._keep_known(normalized, now)
        normalized.sort(key=lambda item: item['kickoff_utc'])
        self.matches = normalized
        future = [item for item in normalized if item['status'] == 'scheduled' and
                  datetime.fromisoformat(item['kickoff_utc'].replace('Z', '+00:00')) > now]
        future_by_team = {}
        for team in self.watched:
            candidate = next((item for item in future if team in item['team_keys']), None)
            if candidate and candidate['id'] not in {m['id'] for m in future_by_team.values()}:
                future_by_team[team] = candidate
        upcoming = sorted(future_by_team.values(), key=lambda item: item['kickoff_utc'])
        recent = [item for item in normalized if item['status'] == 'finished' and
                  datetime.fromisoformat(item['kickoff_utc'].replace('Z', '+00:00')) <= now]
        # A kicked-off match whose result the free feed has not published yet would otherwise
        # vanish from both lists for hours; keep it on top of recent as 'result pending'.
        recent += [{**item, 'result_pending': True} for item in normalized
                   if item['status'] in ('scheduled', 'unknown') and RESULT_WAIT_FROM <= now -
                   datetime.fromisoformat(item['kickoff_utc'].replace('Z', '+00:00')) <= RESULT_WAIT_UNTIL]
        recent.sort(key=lambda item: item['kickoff_utc'], reverse=True)
        self.context = {
            'upcoming': upcoming[0] if upcoming else None,
            'upcoming_matches': upcoming,
            'recent': recent[:9],
            'recent_stats': None,
            'schedule_source': 'football-data.org',
            'schedule_updated_at': datetime.fromtimestamp(latest_cache_time, timezone.utc).isoformat()
                if latest_cache_time else None,
            'schedule_delayed': True,
            'stats_available': False,
            'plan_limited': False,
            'schedule_notice': '무료 일정은 지연될 수 있으며 경기별 세부 스탯은 제공되지 않습니다. '
                               '컵 대회(코파 델 레이·코파 이탈리아 등)는 무료 일정에 없어 표시되지 않을 수 있습니다.',
        }
        return self.context
