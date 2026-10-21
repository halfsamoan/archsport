"""Joins delayed schedules and live fixtures from independent providers."""
import math
from datetime import datetime, time, timedelta, timezone

from .football_data import FootballDataSchedule
from .identity import utc_datetime
from .provider import ACTIVE, ApiFootballLive, ProviderError
from .teams import is_watched

LIVE_POLL_SECONDS = 300
# live=all lists a match only once it is under way, so probing before kickoff only spends budget.
PROBE_BEFORE_KICKOFF = timedelta(0)
PROBE_AFTER_KICKOFF = timedelta(minutes=30)
LIVE_RETRY_GRACE = timedelta(minutes=15)
STARTUP_LOOKBACK = timedelta(hours=4)
# Without a usable schedule, look for watched matches only in European match hours (UTC).
DISCOVERY_SECONDS = 30 * 60
DISCOVERY_HOURS = {False: (time(17, 30), time(21, 30)), True: (time(11), time(21, 30))}  # weekend?
DISCOVERY_NOTICE = '일정 없이 경기 시간대에만 30분마다 라이브를 확인합니다'
# Persisted so a worker restart (settings, resume, reconnect) does not buy an extra probe.
PROBE_STATE_KEY = 'live-probe:api-football'
# ponytail: rough cost of following one match (kickoff probe, ~22 polls, final lookup, a few
# event reads); only used to keep budget for higher-priority clubs when it runs low.
MATCH_REQUESTS = 26


class CompositeProvider:
    def __init__(self, config, store):
        self.schedule = FootballDataSchedule(config, store)
        self.live_poll_seconds = max(300, min(600, int(config.get('poll_seconds', LIVE_POLL_SECONDS))))
        self.daily_budget = int(config.get('daily_budget', 90))
        self.store = store
        try:
            self.live = ApiFootballLive(config, store)
            self._live_startup_error = ''
        except ProviderError as exc:
            self.live = None
            self._live_startup_error = str(exc)
        self.context = self.schedule.context
        self.live_only = True
        self.warning = ''
        self._schedule_warning = ''
        self._scheduled = []
        self._startup_probe = True
        self._last_live_seen = None
        self._live_retry_until = None
        self._live_error = ''
        self.next_poll_seconds = None
        self.retry_after_seconds = None

    def load_context(self, now=None):
        self.context = self.schedule.fetch_context(now)
        self._scheduled = self.schedule.matches
        self._schedule_warning = self.schedule.warning
        self.warning = self._schedule_warning
        return self.context

    def fetch(self, now=None):
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        self.next_poll_seconds = None
        self.retry_after_seconds = None
        if self.live is None:
            matches = []
            self.context['live_available'] = False
            self.context['live_notice'] = self._live_startup_error
            self.warning = ' · '.join(message for message in
                                      (self._schedule_warning, self._live_startup_error) if message)
            return matches
        reason = self._should_probe(now)
        state = self.store.cache_get(PROBE_STATE_KEY, {})
        state = state if isinstance(state, dict) else {}
        # A probe moments ago (often by the previous worker) defers this one instead of repeating it.
        since_last = now.timestamp() - state.get('last', 0)
        wait = math.ceil(self.live_poll_seconds - since_last) if reason and 0 <= since_last < self.live_poll_seconds - 30 else 0
        if not wait:
            self._startup_probe = False
        outage_note = DISCOVERY_NOTICE if self._schedule_warning and not self._scheduled else ''
        if not reason or wait:
            # A cooldown after a provider error (budget, quota) keeps saying why scores stopped.
            cooling = self.retry_after_seconds is not None
            self.context['live_matches'] = []
            self.context['live_available'] = False if cooling else None
            self.context['live_notice'] = self._live_error if cooling else ''
            self.warning = ' · '.join(message for message in
                                      (self._schedule_warning, outage_note, self.context['live_notice']) if message)
            if wait:
                self.next_poll_seconds = wait
            elif self._schedule_warning and not self._scheduled:
                self.next_poll_seconds = 120  # retry the schedule itself
            return []
        state['last'] = now.timestamp()
        if reason == 'discovery':
            state['discovery'] = now.timestamp()
        self.store.cache_set(PROBE_STATE_KEY, state)
        self.next_poll_seconds = self.live_poll_seconds
        try:
            matches = self.live.fetch(now, self._scheduled)
        except ProviderError as exc:
            self.context['live_available'] = False
            self.context['live_notice'] = self._live_error = str(exc)
            if exc.retry_seconds:
                self.retry_after_seconds = max(1, int(exc.retry_seconds))
                self._live_retry_until = now + timedelta(seconds=self.retry_after_seconds)
            self.warning = ' · '.join(message for message in (self._schedule_warning, outage_note, str(exc)) if message)
            return []
        # Finished matches go to the final-score card and results, not to '다른 진행 경기'.
        self.context['live_matches'] = [match for match in matches if match.get('status') in ACTIVE]
        self.context['live_available'] = True
        self.context['live_notice'] = ''
        if any(match.get('status') in ACTIVE for match in matches):
            # Live polls keep their own interval even while the schedule is down.
            self._last_live_seen = now
        elif matches:
            # The adapter confirmed the final whistle; no grace polls for a match that is over.
            self._last_live_seen = None
        elif reason == 'discovery':
            self.next_poll_seconds = 120 if self._schedule_warning and not self._scheduled else DISCOVERY_SECONDS
        self.warning = ' · '.join(message for message in (self._schedule_warning, outage_note, self.live.warning)
                                  if message)
        return matches

    def _should_probe(self, now):
        """Why to read live=all now ('grace', 'kickoff', 'startup', 'discovery'), or None."""
        if self._live_retry_until:
            remaining = (self._live_retry_until - now).total_seconds()
            if remaining > 0:
                self.retry_after_seconds = max(1, int(remaining))
                return None
            self._live_retry_until = None
        if self._last_live_seen and now - self._last_live_seen <= LIVE_RETRY_GRACE:
            return 'grace'
        reserved = self._budget_reserved(now)
        for match in self._scheduled:
            kickoff = self._watched_kickoff(match)
            if not kickoff or match['id'] in reserved:
                continue
            remaining = kickoff - now
            if -PROBE_AFTER_KICKOFF <= remaining <= PROBE_BEFORE_KICKOFF:
                return 'kickoff'
            if self._startup_probe and -STARTUP_LOOKBACK <= remaining < -PROBE_AFTER_KICKOFF:
                return 'startup'
        if not self._scheduled:
            start, end = DISCOVERY_HOURS[now.weekday() >= 5]
            state = self.store.cache_get(PROBE_STATE_KEY, {})
            last = state.get('discovery') if isinstance(state, dict) else None
            if start <= now.time() <= end and (last is None or now.timestamp() - last >= DISCOVERY_SECONDS - 60):
                return 'discovery'
        return None

    def _watched_kickoff(self, match):
        if match.get('status') != 'scheduled' or not any(
                is_watched(match.get(side), self.schedule.watched) for side in ('home', 'away')):
            return None
        try:
            return utc_datetime(match.get('kickoff_utc'))
        except (TypeError, ValueError):
            return None

    def _budget_reserved(self, now):
        """Today's lower-priority fixtures to skip so the rest of the budget follows better-loved clubs."""
        left = self.daily_budget - self.store.requests_used(now.date().isoformat())
        order = {team: index for index, team in enumerate(self.schedule.watched)}
        today = [match for match in self._scheduled if (kickoff := self._watched_kickoff(match))
                 and kickoff.date() == now.date() and kickoff >= now - timedelta(hours=2)]
        today.sort(key=lambda match: min((order.get(key, 999) for key in match.get('team_keys') or ()), default=999))
        reserved = set()
        for index, match in enumerate(today):
            # The best-loved club's match is always followed, however little budget is left.
            if index and left < MATCH_REQUESTS:
                reserved.add(match['id'])
            left -= MATCH_REQUESTS
        return reserved
