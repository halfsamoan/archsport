import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone

from archsport.composite import CompositeProvider
from archsport.engine import Store
from archsport.provider import ProviderError

NOW = datetime(2026, 10, 18, 15, tzinfo=timezone.utc)


class CompositeProviderTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.football_key = self.directory / 'football-data-token'
        self.football_key.write_text('test-token', encoding='utf-8')
        self.api_key = self.directory / 'missing-api-key'

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def config(self):
        return {'football_data_key_file': str(self.football_key),
                'key_file': str(self.api_key), 'watch_teams': ['Barcelona'],
                'daily_budget': 90}

    def test_missing_live_key_keeps_schedule_context(self):
        provider = CompositeProvider(self.config(), self.store)
        scheduled = {'id': 'match:barcelona:sevilla:20261020', 'home': 'Barcelona'}
        provider.context = {'upcoming_matches': [scheduled]}
        provider._scheduled = [scheduled]

        self.assertEqual(provider.fetch(), [])
        self.assertEqual(provider.context['upcoming_matches'], [scheduled])
        self.assertFalse(provider.context['live_available'])
        self.assertIn('API 키', provider.warning)

    def test_live_request_error_keeps_schedule_context(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        scheduled = {'id': 'match:barcelona:sevilla:20261020', 'home': 'Barcelona'}
        scheduled.update(away='Sevilla', status='scheduled',
                         kickoff_utc=(NOW + timedelta(minutes=1)).isoformat())
        provider.context = {'upcoming_matches': [scheduled]}
        provider._scheduled = [scheduled]

        def fail(*_args, **_kwargs):
            raise ProviderError('라이브 연결 오류')

        provider.live.fetch = fail
        self.assertEqual(provider.fetch(NOW), [])
        self.assertEqual(provider.context['upcoming_matches'], [scheduled])
        self.assertFalse(provider.context['live_available'])
        self.assertEqual(provider.context['live_notice'], '라이브 연결 오류')

    def test_live_feed_is_probed_only_near_kickoff_and_has_a_five_minute_interval(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        now = NOW
        fixture = {'id': 'match:barcelona:sevilla:20261018', 'home': 'Barcelona',
                   'away': 'Sevilla', 'status': 'scheduled',
                   'kickoff_utc': (now + timedelta(hours=4)).isoformat()}
        provider._scheduled = [fixture]
        calls = []

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append((at, scheduled))
                return []

        provider.live = Live()
        self.assertEqual(provider.fetch(now), [])
        self.assertEqual(calls, [])
        self.assertIsNone(provider.next_poll_seconds)

        near_kickoff = now + timedelta(hours=3, minutes=55)
        self.assertEqual(provider.fetch(near_kickoff), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(provider.next_poll_seconds, 300)

    def test_live_feed_observes_configured_ten_minute_interval(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        config = self.config()
        config['poll_seconds'] = 600
        provider = CompositeProvider(config, self.store)
        fixture = {'id': 'match:barcelona:sevilla:20261018', 'home': 'Barcelona',
                   'away': 'Sevilla', 'status': 'scheduled',
                   'kickoff_utc': (NOW + timedelta(minutes=1)).isoformat()}
        provider._scheduled = [fixture]

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                return []

        provider.live = Live()
        self.assertEqual(provider.fetch(NOW), [])
        self.assertEqual(provider.next_poll_seconds, 600)

    def test_provider_retry_cooldown_blocks_live_calls_until_retry_time(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        fixture = {'id': 'match:barcelona:sevilla:20261018', 'home': 'Barcelona',
                   'away': 'Sevilla', 'status': 'scheduled',
                   'kickoff_utc': (NOW + timedelta(minutes=1)).isoformat()}
        provider._scheduled = [fixture]
        calls = []

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append(at)
                if len(calls) == 1:
                    raise ProviderError('일일 한도', retry_seconds=600)
                return []

        provider.live = Live()
        provider.fetch(NOW)
        self.assertEqual(provider.retry_after_seconds, 600)
        provider.fetch(NOW + timedelta(minutes=5))
        self.assertEqual(len(calls), 1)
        self.assertEqual(provider.retry_after_seconds, 300)
        provider.fetch(NOW + timedelta(minutes=10))
        self.assertEqual(len(calls), 2)
        self.assertIsNone(provider.retry_after_seconds)

    def test_schedule_outage_keeps_low_frequency_live_discovery(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        provider._schedule_warning = 'football-data.org 일정 연결 오류'
        calls = []

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append((at, scheduled))
                return []

        provider.live = Live()
        self.assertEqual(provider.fetch(NOW), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(provider.next_poll_seconds, 30 * 60)

        self.assertEqual(provider.fetch(NOW + timedelta(minutes=5)), [])
        self.assertEqual(len(calls), 1)

        self.assertEqual(provider.fetch(NOW + timedelta(minutes=30)), [])
        self.assertEqual(len(calls), 2)

    def test_empty_schedule_also_checks_live_feed_on_cold_start(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        calls = []

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append((at, scheduled))
                return []

        provider.live = Live()
        self.assertEqual(provider.fetch(NOW), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(provider.next_poll_seconds, 30 * 60)


if __name__ == '__main__':
    unittest.main()
