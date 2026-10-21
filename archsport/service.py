"""One refresh transaction and payload assembly, independent of GNOME."""
from datetime import datetime, timedelta, timezone

from .identity import same_fixture, utc_datetime
from .provider import ACTIVE, ProviderError
from .scheduler import match_visible, poll_interval, schedule_wake_seconds
from .teams import canonical_team, normalize_watch_list

SCHEDULE_REFRESH_SECONDS = 6 * 60 * 60
# The final whistle stays on the notch this long after it was first observed.
FINAL_SHOW_SECONDS = 10 * 60
# API-Football final scores stand in for the hours football-data needs to publish a result.
PROVISIONAL_KEY = 'provisional-results'
# ponytail: a result football-data never covers (a cup match) simply ages out after two days.
PROVISIONAL_KEEP = timedelta(days=2)
RESULT_FIELDS = ('home_score', 'away_score', 'home_penalties', 'away_penalties')


def merge_provisional(recent, results, now):
    """Return recent rows with provisional finals merged in, and the finals still unconfirmed."""
    rows = list(recent or [])
    keep = {}
    for identifier, result in results.items():
        try:
            kickoff = utc_datetime(result.get('kickoff_utc'))
        except (TypeError, ValueError):
            continue
        if not kickoff or now - kickoff > PROVISIONAL_KEEP:
            continue
        index = next((position for position, row in enumerate(rows)
                      if row.get('id') == identifier or same_fixture(row, result)), None)
        if index is not None and rows[index].get('status') == 'finished' and not rows[index].get('provisional'):
            continue  # football-data published the real result
        final = {key: result.get(key) for key in RESULT_FIELDS}
        if index is None:
            rows.append({**{key: value for key, value in result.items() if key not in ('events', 'finished_at')},
                         'status': 'finished', 'provisional': True})
        else:
            # Replaces the 'result pending' row in place, keeping football-data's own fields.
            row = {key: value for key, value in rows[index].items() if key != 'result_pending'}
            rows[index] = {**row, **final, 'status': 'finished', 'provisional': True}
        keep[identifier] = result
    rows.sort(key=lambda row: row.get('kickoff_utc') or '', reverse=True)
    return rows[:9], keep


class Worker:
    def __init__(self, config, store, provider, logos=None):
        self.config, self.store, self.provider, self.logos = config, store, provider, logos
        self.watched = normalize_watch_list(config.get('watch_teams', [config.get('team_name', 'Barcelona')]))
        self.first = True
        self.errors = 0
        self.latest_matches = {}
        self.latest_seen = {}
        self.last_interval = None
        seen_values = []
        if config['mode'] == 'live':
            for match, seen in store.latest_all():
                if match.get('status') not in ('live', 'halftime', 'extra_time', 'penalties', 'interrupted'):
                    continue
                if not any(canonical_team(match.get(side)) in self.watched for side in ('home', 'away')):
                    continue
                self.latest_matches[match['id']] = match
                self.latest_seen[match['id']] = seen
                seen_values.append(seen)
        self.last_success = datetime.fromtimestamp(max(seen_values), timezone.utc).isoformat() if seen_values else None

    def _poll_window_seconds(self):
        return max(300, min(600, int(self.config.get('poll_seconds', 300))))

    def _stale_after_seconds(self):
        return max(300, 2 * self._poll_window_seconds() + 60)

    def _recent_success(self, now, max_age=None):
        if not self.last_success:
            return False
        try:
            age = now.timestamp() - datetime.fromisoformat(self.last_success).timestamp()
            return 0 <= age <= (self._stale_after_seconds() if max_age is None else max_age)
        except (TypeError, ValueError, OverflowError):
            return False

    def poll(self, now=None):
        now = now or datetime.now(timezone.utc)
        context = getattr(self.provider, 'context', {})
        kickoff_alert = None
        selected = None
        event_alert = None
        try:
            if hasattr(self.provider, 'load_context'):
                context = self.provider.load_context(now) or context
            if isinstance(context, dict) and self.logos:
                for fixtures in (context.get('upcoming_matches', []), context.get('recent', [])):
                    for fixture in fixtures:
                        self.logos.decorate(fixture)
            result = self.provider.fetch()
            matches = result if isinstance(result, list) else ([result] if result else [])
            active = []
            for match in matches:
                if not isinstance(match, dict) or not any(
                        canonical_team(match.get(side)) in self.watched for side in ('home', 'away')):
                    continue
                if self.logos:
                    match = self.logos.decorate(match)
                self.latest_matches[match['id']] = match
                self.latest_seen[match['id']] = now.timestamp()
                if match.get('status') == 'finished' and match.get('source') == 'api-football':
                    match['finished_at'] = self._remember_final(match, now)
                previous_interval = min(600, int(self.last_interval or self._poll_window_seconds()))
                max_gap = max(120, 2 * previous_interval + 60)
                alert = self.store.ingest(match, now.timestamp(), suppress=self.first,
                                          max_gap_seconds=max_gap, catchup=self.first)
                active.append((match, alert))
            # The error path only reuses a snapshot younger than stale_after; drop older ones.
            cutoff = now.timestamp() - self._stale_after_seconds()
            for identifier in [key for key, seen in self.latest_seen.items() if seen < cutoff]:
                del self.latest_matches[identifier], self.latest_seen[identifier]
            if isinstance(context, dict) and self.logos:
                for match in context.get('live_matches', []):
                    self.logos.decorate(match)
            active.sort(key=lambda pair: self._team_priority(pair[0]))
            alert_pair = next((pair for pair in active if pair[1]), None)
            live = [pair[0] for pair in active if pair[0].get('status') in ACTIVE]
            if alert_pair:
                selected, event_alert = alert_pair
                event_alert['match_id'] = selected['id']
                event_alert['kickoff_utc'] = selected.get('kickoff_utc')
            elif live:
                selected = live[0]
            else:
                selected = self._final_on_show(now)
            self.first, self.errors = False, 0
            self.last_success = now.isoformat()
            context = getattr(self.provider, 'context', context)
            self._merge_finals(context, now)
            kickoff_alert, kickoff_match = self._kickoff_reminder(context, now) if not event_alert else (None, None)
            if kickoff_alert and not event_alert:
                selected = kickoff_match
            self.first, self.errors = False, 0
            live_seconds = max(300, self.config['poll_seconds']) if getattr(self.provider, 'live_only', False) else self.config['poll_seconds']
            upcoming = context.get('upcoming_matches', []) if isinstance(context, dict) else []
            interval = poll_interval(selected if selected and selected.get('status') in
                                     ('live', 'halftime', 'extra_time', 'penalties', 'interrupted') else None,
                                     now, live_seconds, upcoming_matches=upcoming)
            final_left = self._final_seconds_left(selected, now)
            if final_left:
                # Poll again when the final card is due to leave, so it never outstays its window.
                interval = min(interval, max(15, final_left))
            retry_after = getattr(self.provider, 'retry_after_seconds', None)
            if retry_after:
                # A provider quota/plan cooldown blocks that provider, while
                # schedule reminders and the six-hour schedule refresh remain active.
                wake_for_fixture = schedule_wake_seconds(upcoming, now)
                interval = min(int(retry_after), wake_for_fixture or SCHEDULE_REFRESH_SECONDS)
                interval = max(1, interval)
            else:
                recommended = getattr(self.provider, 'next_poll_seconds', None)
                if recommended:
                    interval = min(interval, recommended)
            message = getattr(self.provider, 'warning', '')
            if not selected and not message:
                message = '진행 중인 경기가 없습니다.'
            alert = event_alert or kickoff_alert
            payload = {'mode': self.config['mode'], 'health': 'fresh' if selected and
                       selected.get('status') in ('live', 'halftime', 'extra_time', 'penalties', 'interrupted') else 'idle',
                       'match': selected, 'alert': alert, 'updated_at': self.last_success,
                       'visible': match_visible(selected, now) or bool(kickoff_alert) or bool(final_left),
                       'message': message,
                       'next_poll_seconds': interval,
                       'stale_after_seconds': self._stale_after_seconds(),
                       'context': context}
        except (ProviderError, KeyError, TypeError, ValueError, OSError) as exc:
            self.errors += 1
            self.first = True
            message = str(exc) if isinstance(exc, ProviderError) else '경기 응답을 해석할 수 없습니다. 데이터 설정을 확인하세요.'
            retry_seconds = getattr(exc, 'retry_seconds', None)
            context = getattr(self.provider, 'context', context)
            if isinstance(context, dict) and self.logos:
                for fixtures in (context.get('upcoming_matches', []), context.get('recent', [])):
                    for fixture in fixtures:
                        self.logos.decorate(fixture)
            self._merge_finals(context, now)
            kickoff_alert, kickoff_match = self._kickoff_reminder(context, now)
            latest_id = max(self.latest_matches,
                            key=lambda identifier: self.latest_seen.get(identifier, 0), default=None)
            latest = self.latest_matches.get(latest_id) if latest_id is not None else None
            stale_after = self._stale_after_seconds()
            fresh_match = latest and now.timestamp() - self.latest_seen.get(latest_id, 0) <= stale_after
            if fresh_match:
                selected = latest
            elif kickoff_alert:
                selected = kickoff_match
            payload = {'mode': self.config['mode'], 'health': 'error', 'message': message,
                       'match': selected, 'alert': kickoff_alert, 'updated_at': self.last_success,
                       'visible': (match_visible(selected, now) and self._recent_success(now, stale_after)) or bool(kickoff_alert),
                       'context': context,
                       'stale_after_seconds': stale_after,
                       'next_poll_seconds': retry_seconds if retry_seconds is not None else
                       min(300, 30 * 2 ** min(self.errors - 1, 4))}
        if self.config['mode'] == 'demo':
            payload['next_poll_seconds'] = 4
            payload['visible'] = True
        self.last_interval = payload.get('next_poll_seconds')
        return payload

    def _remember_final(self, match, now):
        results = self.store.cache_get(PROVISIONAL_KEY, {})
        if not isinstance(results, dict):
            results = {}
        first_seen = (results.get(match['id']) or {}).get('finished_at', now.timestamp())
        results[match['id']] = {**match, 'provisional': True, 'finished_at': first_seen}
        self.store.cache_set(PROVISIONAL_KEY, results)
        return first_seen

    def _final_seconds_left(self, match, now):
        if not match or match.get('status') != 'finished' or not isinstance(match.get('finished_at'), (int, float)):
            return 0
        return max(0, int(match['finished_at'] + FINAL_SHOW_SECONDS - now.timestamp()))

    def _final_on_show(self, now):
        results = self.store.cache_get(PROVISIONAL_KEY, {})
        shown = [result for result in (results.values() if isinstance(results, dict) else ())
                 if self._final_seconds_left(result, now)]
        return max(shown, key=lambda result: result['finished_at'], default=None)

    def _merge_finals(self, context, now):
        results = self.store.cache_get(PROVISIONAL_KEY, {})
        if not isinstance(context, dict) or not isinstance(results, dict) or not results:
            return
        context['recent'], keep = merge_provisional(context.get('recent'), results, now)
        if keep != results:
            self.store.cache_set(PROVISIONAL_KEY, keep)

    def _team_priority(self, match):
        priorities = {team: index for index, team in enumerate(self.watched)}
        return min((priorities.get(canonical_team(match.get(side)), 999)
                    for side in ('home', 'away')), default=999)

    def _kickoff_reminder(self, context, now):
        if not isinstance(context, dict):
            return None, None
        fixtures = context.get('upcoming_matches') or ([context['upcoming']] if context.get('upcoming') else [])
        for match in sorted(fixtures, key=lambda item: item.get('kickoff_utc') or ''):
            value = match.get('kickoff_utc')
            if not value or match.get('status') != 'scheduled':
                continue
            try:
                kickoff = datetime.fromisoformat(value.replace('Z', '+00:00'))
                if kickoff.tzinfo is None:
                    kickoff = kickoff.replace(tzinfo=timezone.utc)
                seconds = (kickoff.astimezone(timezone.utc) - now.astimezone(timezone.utc)).total_seconds()
            except (TypeError, ValueError):
                continue
            kind = '15m' if 0 < seconds <= 900 else '2h' if 900 < seconds <= 7200 else None
            if not kind or not self.store.insert_receipt(match['id'], 'kickoff:' + kind):
                continue
            watched = next((team for team in match.get('team_keys', []) if team in self.watched), None)
            club = next((match[side] for side in ('home', 'away') if canonical_team(match.get(side)) == watched), '경기')
            opponent = match['away'] if match['home'] == club else match['home']
            hours = '15분 후 경기' if kind == '15m' else '2시간 후 경기'
            return {'kind': 'kickoff', 'title': hours, 'club': club, 'opponent': opponent,
                    'kickoff_utc': value, 'match_id': match['id']}, match
        return None, None
