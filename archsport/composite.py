"""Joins delayed schedules and live fixtures from independent providers."""
from datetime import datetime, timedelta, timezone

from .football_data import FootballDataSchedule
from .identity import utc_datetime
from .provider import ACTIVE, ApiFootballLive, ProviderError
from .teams import is_watched

LIVE_POLL_SECONDS = 300
PROBE_BEFORE_KICKOFF = timedelta(minutes=5)
PROBE_AFTER_KICKOFF = timedelta(minutes=30)
LIVE_RETRY_GRACE = timedelta(minutes=15)
STARTUP_LOOKBACK = timedelta(hours=4)
SCHEDULE_OUTAGE_LIVE_POLL_SECONDS = 30 * 60


class CompositeProvider:
    def __init__(self, config, store):
        self.schedule = FootballDataSchedule(config, store)
        self.live_poll_seconds = max(300, min(600, int(config.get('poll_seconds', LIVE_POLL_SECONDS))))
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
        self._last_schedule_outage_probe = None
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
        probe = self._should_probe(now)
        self._startup_probe = False
        if not probe:
            # A cooldown after a provider error (budget, quota) keeps saying why scores stopped.
            cooling = self.retry_after_seconds is not None
            self.context['live_matches'] = []
            self.context['live_available'] = False if cooling else None
            self.context['live_notice'] = self._live_error if cooling else ''
            self.warning = ' · '.join(message for message in
                                      (self._schedule_warning, self.context['live_notice']) if message)
            if self._schedule_warning or not self._scheduled:
                self.next_poll_seconds = (120 if self._schedule_warning and not self._scheduled
                                          else SCHEDULE_OUTAGE_LIVE_POLL_SECONDS)
            return []
        schedule_outage = bool(self._schedule_warning or not self._scheduled)
        self.next_poll_seconds = (120 if self._schedule_warning and not self._scheduled else
                                  SCHEDULE_OUTAGE_LIVE_POLL_SECONDS if schedule_outage else
                                  self.live_poll_seconds)
        if schedule_outage:
            self._last_schedule_outage_probe = now
        try:
            matches = self.live.fetch(now, self._scheduled)
        except ProviderError as exc:
            self.context['live_available'] = False
            self.context['live_notice'] = self._live_error = str(exc)
            if exc.retry_seconds:
                self.retry_after_seconds = max(1, int(exc.retry_seconds))
                self._live_retry_until = now + timedelta(seconds=self.retry_after_seconds)
            self.warning = ' · '.join(message for message in (self._schedule_warning, str(exc)) if message)
            return []
        # Finished matches go to the final-score card and results, not to '다른 진행 경기'.
        self.context['live_matches'] = [match for match in matches if match.get('status') in ACTIVE]
        self.context['live_available'] = True
        self.context['live_notice'] = ''
        if any(match.get('status') in ACTIVE for match in matches):
            self._last_live_seen = now
        elif matches:
            # The adapter confirmed the final whistle; no grace polls for a match that is over.
            self._last_live_seen = None
        elif self._last_live_seen and now - self._last_live_seen <= LIVE_RETRY_GRACE:
            self.next_poll_seconds = self.live_poll_seconds
        self.warning = ' · '.join(message for message in (self._schedule_warning, self.live.warning) if message)
        return matches

    def _should_probe(self, now):
        if self._live_retry_until:
            remaining = (self._live_retry_until - now).total_seconds()
            if remaining > 0:
                self.retry_after_seconds = max(1, int(remaining))
                return False
            self._live_retry_until = None
        if self._last_live_seen and now - self._last_live_seen <= LIVE_RETRY_GRACE:
            return True
        for match in self._scheduled:
            if match.get('status') != 'scheduled' or not any(
                    is_watched(match.get(side), self.schedule.watched) for side in ('home', 'away')):
                continue
            try:
                kickoff = utc_datetime(match.get('kickoff_utc'))
            except (TypeError, ValueError):
                continue
            if not kickoff:
                continue
            remaining = kickoff - now
            if -PROBE_AFTER_KICKOFF <= remaining <= PROBE_BEFORE_KICKOFF:
                return True
            if self._startup_probe and -STARTUP_LOOKBACK <= remaining < -PROBE_AFTER_KICKOFF:
                return True
        if self._schedule_warning or not self._scheduled:
            if self._last_schedule_outage_probe is None:
                return True
            return now - self._last_schedule_outage_probe >= timedelta(
                seconds=SCHEDULE_OUTAGE_LIVE_POLL_SECONDS)
        return False
