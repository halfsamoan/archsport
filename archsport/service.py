"""One refresh transaction and payload assembly, independent of GNOME."""
from datetime import datetime, timezone

from .provider import ProviderError
from .scheduler import match_visible, poll_interval, schedule_wake_seconds
from .teams import canonical_team, normalize_watch_list

SCHEDULE_REFRESH_SECONDS = 6 * 60 * 60


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
                previous_interval = min(600, int(self.last_interval or self._poll_window_seconds()))
                max_gap = max(120, 2 * previous_interval + 60)
                alert = self.store.ingest(match, now.timestamp(), suppress=self.first,
                                          max_gap_seconds=max_gap)
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
            if alert_pair:
                selected, event_alert = alert_pair
                event_alert['match_id'] = selected['id']
                event_alert['kickoff_utc'] = selected.get('kickoff_utc')
            elif active:
                selected = active[0][0]
            self.first, self.errors = False, 0
            self.last_success = now.isoformat()
            context = getattr(self.provider, 'context', context)
            kickoff_alert, kickoff_match = self._kickoff_reminder(context, now) if not event_alert else (None, None)
            if kickoff_alert and not event_alert:
                selected = kickoff_match
            self.first, self.errors = False, 0
            live_seconds = max(300, self.config['poll_seconds']) if getattr(self.provider, 'live_only', False) else self.config['poll_seconds']
            upcoming = context.get('upcoming_matches', []) if isinstance(context, dict) else []
            interval = poll_interval(selected if selected and selected.get('status') in
                                     ('live', 'halftime', 'extra_time', 'penalties', 'interrupted') else None,
                                     now, live_seconds, upcoming_matches=upcoming)
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
                       'visible': match_visible(selected, now) or bool(kickoff_alert),
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
