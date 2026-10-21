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
        self.assertIn('API-Football 키', provider.warning)

    def test_live_request_error_keeps_schedule_context(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        scheduled = {'id': 'match:barcelona:sevilla:20261020', 'home': 'Barcelona'}
        scheduled.update(away='Sevilla', status='scheduled',
                         kickoff_utc=(NOW - timedelta(minutes=1)).isoformat())
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

        # Nothing is listed before kickoff, so the first probe waits for it.
        self.assertEqual(provider.fetch(now + timedelta(hours=3, minutes=55)), [])
        self.assertEqual(calls, [])
        near_kickoff = now + timedelta(hours=4)
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
                   'kickoff_utc': (NOW - timedelta(minutes=1)).isoformat()}
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
                   'kickoff_utc': (NOW - timedelta(minutes=1)).isoformat()}
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
        # The cooldown still says why scores stopped.
        self.assertIs(provider.context['live_available'], False)
        self.assertEqual(provider.context['live_notice'], '일일 한도')
        self.assertIn('일일 한도', provider.warning)
        provider.fetch(NOW + timedelta(minutes=10))
        self.assertEqual(len(calls), 2)
        self.assertIsNone(provider.retry_after_seconds)

    def test_schedule_outage_keeps_low_frequency_live_discovery(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        provider._schedule_warning = 'football-data.org 일정 연결 오류'
        provider._scheduled = []
        calls = []

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append((at, scheduled))
                return []

        provider.live = Live()
        self.assertEqual(provider.fetch(NOW), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(provider.next_poll_seconds, 120)

        self.assertEqual(provider.fetch(NOW + timedelta(minutes=5)), [])
        self.assertEqual(len(calls), 1)

        self.assertEqual(provider.fetch(NOW + timedelta(minutes=30)), [])
        self.assertEqual(len(calls), 2)

    def test_confirmed_final_whistle_ends_the_grace_polls(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        provider._scheduled = [{'id': 'match:barcelona:sevilla:20261018', 'home': 'Barcelona',
                                'away': 'Sevilla', 'status': 'scheduled',
                                'kickoff_utc': (NOW - timedelta(hours=2)).isoformat()}]
        feeds = [[{'id': 'm', 'status': 'live'}], [{'id': 'm', 'status': 'finished'}]]
        calls = []

        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append(at)
                return feeds.pop(0) if feeds else []

        provider.live = Live()
        provider.fetch(NOW)
        provider.fetch(NOW + timedelta(minutes=5))
        provider.fetch(NOW + timedelta(minutes=10))
        self.assertEqual(len(calls), 2)

    def live(self, calls, feed=()):
        class Live:
            warning = ''
            def fetch(self, at, scheduled):
                calls.append(at)
                return [dict(match) for match in feed]
        return Live()

    def fixture(self, team, kickoff):
        return {'id': f'match:{team}:{kickoff:%H%M}', 'home': team, 'away': 'Example FC', 'status': 'scheduled',
                'kickoff_utc': kickoff.isoformat(), 'team_keys': [team.casefold(), None]}

    def test_worker_restart_right_after_a_probe_defers_instead_of_probing_again(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        calls = []
        first = CompositeProvider(self.config(), self.store)
        first._scheduled = [self.fixture('Barcelona', NOW - timedelta(minutes=1))]
        first.live = self.live(calls)
        first.fetch(NOW)
        restarted = CompositeProvider(self.config(), self.store)
        restarted._scheduled = first._scheduled
        restarted.live = self.live(calls)
        restarted.fetch(NOW + timedelta(minutes=1))
        self.assertEqual(len(calls), 1)
        self.assertEqual(restarted.next_poll_seconds, 240)
        restarted.fetch(NOW + timedelta(minutes=5))
        self.assertEqual(len(calls), 2)

    def test_schedule_outage_looks_for_matches_only_in_match_hours_and_says_so(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        calls = []
        wednesday = datetime(2026, 10, 21, 3, tzinfo=timezone.utc)

        def provider():
            value = CompositeProvider(self.config(), self.store)
            value._schedule_warning = 'football-data.org 일정 키가 없습니다.'
            value.live = self.live(calls)
            return value

        night = provider()
        night.fetch(wednesday)
        self.assertEqual(calls, [])
        self.assertIn('경기 시간대에만', night.warning)
        provider().fetch(wednesday.replace(hour=18))
        self.assertEqual(len(calls), 1)
        # The discovery spacing survives a restart.
        provider().fetch(wednesday.replace(hour=18, minute=10))
        self.assertEqual(len(calls), 1)

    def test_day_without_a_scheduled_match_looks_for_cup_ties_in_the_evening(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        calls = []
        wednesday = datetime(2026, 10, 21, 18, tzinfo=timezone.utc)
        provider = CompositeProvider(self.config(), self.store)
        provider.live = self.live(calls)
        provider._scheduled = [self.fixture('Barcelona', wednesday + timedelta(days=1))]
        provider.fetch(wednesday)
        self.assertEqual(len(calls), 1)
        self.assertEqual(provider.warning, '')  # normal operation, not an outage
        # A day with a scheduled match keeps to that match's window.
        provider._scheduled = [self.fixture('Barcelona', wednesday + timedelta(hours=3))]
        provider.fetch(wednesday + timedelta(hours=1))
        self.assertEqual(len(calls), 1)

    def test_live_match_found_during_schedule_outage_keeps_the_live_interval(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        provider = CompositeProvider(self.config(), self.store)
        provider._schedule_warning = 'football-data.org 일정 서버에 연결할 수 없습니다.'
        provider.live = self.live([], [{'id': 'live', 'status': 'live'}])
        provider.fetch(NOW)
        self.assertEqual(provider.next_poll_seconds, 300)

    def test_low_budget_is_kept_for_the_higher_priority_club(self):
        self.api_key.write_text('test-api-key', encoding='utf-8')
        config = {**self.config(), 'watch_teams': ['Barcelona', 'Lazio']}
        calls = []
        provider = CompositeProvider(config, self.store)
        provider._scheduled = [self.fixture('Lazio', NOW - timedelta(minutes=1)),
                               self.fixture('Barcelona', NOW + timedelta(hours=3))]
        provider.live = self.live(calls)
        self.store.db.execute('INSERT INTO requests VALUES (?, ?)', (NOW.date().isoformat(), 50))
        provider.fetch(NOW)
        self.assertEqual(calls, [])  # 40 left: Barcelona's evening match keeps them
        self.store.db.execute('UPDATE requests SET count=10')
        provider.fetch(NOW + timedelta(minutes=5))
        self.assertEqual(len(calls), 1)

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
