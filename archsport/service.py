"""One refresh transaction and payload assembly, independent of GNOME."""
from datetime import datetime, timezone

from .provider import ProviderError
from .scheduler import match_visible, poll_interval


class Worker:
    def __init__(self, config, store, provider, logos=None):
        self.config, self.store, self.provider, self.logos = config, store, provider, logos
        self.first = True
        self.errors = 0
        self.latest, seen = store.latest() if config['mode'] == 'live' else (None, None)
        if self.latest and config['team_name'].casefold() not in (self.latest['home'].casefold(), self.latest['away'].casefold()):
            self.latest, seen = None, None
        self.last_success = datetime.fromtimestamp(seen, timezone.utc).isoformat() if seen else None

    def _recent_success(self, now, max_age=300):
        if not self.last_success:
            return False
        try:
            age = now.timestamp() - datetime.fromisoformat(self.last_success).timestamp()
            return 0 <= age <= max_age
        except (TypeError, ValueError, OverflowError):
            return False

    def poll(self, now=None):
        now = now or datetime.now(timezone.utc)
        try:
            match = self.provider.fetch()
            alert = self.store.ingest(match, now.timestamp(), suppress=self.first) if match else None
            self.first, self.errors = False, 0
            if match and self.logos:
                match = self.logos.decorate(match)
            self.latest, self.last_success = match, now.isoformat()
            finished_at = match.get('finished_at') if match else None
            interval = poll_interval(match, now, self.config['poll_seconds'], finished_at)
            payload = {'mode': self.config['mode'], 'health': 'fresh' if match else 'idle',
                       'match': match, 'alert': alert, 'updated_at': self.last_success,
                       'visible': match_visible(match, now, finished_at),
                       'message': getattr(self.provider, 'warning', '') if match else '등록된 다음 경기가 없습니다.',
                       'next_poll_seconds': interval,
                       'context': getattr(self.provider, 'context', {})}
        except (ProviderError, KeyError, TypeError, ValueError, OSError) as exc:
            self.errors += 1
            self.first = True
            message = str(exc) if isinstance(exc, ProviderError) else '경기 응답을 해석할 수 없습니다. 데이터 설정을 확인하세요.'
            payload = {'mode': self.config['mode'], 'health': 'error', 'message': message,
                       'match': self.latest, 'alert': None, 'updated_at': self.last_success,
                       'visible': match_visible(self.latest, now) and self._recent_success(now),
                       'context': getattr(self.provider, 'context', {}),
                       'next_poll_seconds': min(300, 30 * 2 ** min(self.errors - 1, 4))}
        if self.config['mode'] == 'demo':
            payload['next_poll_seconds'] = 4
            payload['visible'] = True
        return payload
