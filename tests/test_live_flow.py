import copy
import io
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from archsport.engine import Store
from archsport.provider import ApiFootball, ProviderError, normalize
from archsport.scheduler import match_visible, poll_interval
from archsport.service import Worker

NOW = datetime(2030, 1, 1, 20, 0, tzinfo=timezone.utc)
RAW = json.loads((Path(__file__).parents[1] / 'data/provider-fixture.json').read_text(encoding='utf-8'))['response'][0]


class Response(io.BytesIO):
    headers = {}


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.item = copy.deepcopy(RAW)
        self.item['fixture']['status'].update(short='1H', elapsed=1)
        self.item['goals'] = {'home': 0, 'away': 0}
        self.calls = []
        self.fail_events = False
        self.env = patch.dict(os.environ, {'ARCHSPORT_API_KEY': 'unit-test-not-a-real-secret'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.store.close()

    def opener(self, request, **kwargs):
        parsed = urlparse(request.full_url)
        params = parse_qs(parsed.query)
        self.calls.append((parsed.path, params))
        if parsed.path == '/teams':
            data = [{'team': {'id': 529, 'name': 'Barcelona', 'country': 'Spain'}}]
        elif parsed.path == '/fixtures/events':
            if self.fail_events:
                raise ProviderError('event timeout')
            data = [{'type': 'Goal', 'detail': 'Normal Goal', 'time': {'elapsed': 31},
                     'team': {'name': 'Barcelona'}, 'player': {'name': 'Synthetic Player'}}]
        else:
            data = [copy.deepcopy(self.item)]
        return Response(json.dumps({'errors': [], 'response': data}).encode())

    def provider(self, **options):
        return ApiFootball({'daily_budget': 100, 'team_id': 529,
                            'team_name': 'Barcelona', 'team_country': 'Spain', **options},
                           self.store, opener=self.opener)

    def test_unchanged_polls_do_not_fetch_events(self):
        provider = self.provider()
        provider.fetch(NOW)
        provider.fetch(NOW + timedelta(seconds=60))
        self.assertEqual([p for p, _ in self.calls], ['/fixtures', '/fixtures'])
        self.assertIn('id', self.calls[-1][1])

    def test_score_change_fetches_events_once(self):
        provider = self.provider()
        provider.fetch(NOW)
        self.item['goals']['home'] = 1
        changed = provider.fetch(NOW + timedelta(seconds=60))
        provider.fetch(NOW + timedelta(seconds=120))
        self.assertEqual(sum(p == '/fixtures/events' for p, _ in self.calls), 1)
        self.assertEqual(changed['events'][0]['player'], 'Synthetic Player')

    def test_status_change_fetches_events_once(self):
        provider = self.provider()
        provider.fetch(NOW)
        self.item['fixture']['status']['short'] = 'HT'
        provider.fetch(NOW + timedelta(seconds=60))
        provider.fetch(NOW + timedelta(seconds=120))
        self.assertEqual(sum(p == '/fixtures/events' for p, _ in self.calls), 1)

    def test_failed_event_fetch_does_not_lose_score(self):
        provider = self.provider()
        provider.fetch(NOW)
        self.item['goals']['home'] = 1
        provider.fetch(NOW)
        self.item['goals']['home'] = 2
        self.fail_events = True
        failed = provider.fetch(NOW)
        self.assertEqual(failed['home_score'], 2)
        self.assertEqual(failed['events'], [])
        self.assertTrue(provider.warning)
        self.fail_events = False
        self.assertEqual(provider.fetch(NOW)['events'][0]['kind'], 'Goal')

    def test_team_resolution_is_cached_across_provider_instances(self):
        self.provider(team_id=None).fetch(NOW)
        self.provider(team_id=None).fetch(NOW)
        self.assertEqual(sum(p == '/teams' for p, _ in self.calls), 1)
        self.assertEqual(self.store.cache_get('team:barcelona:spain'), 529)

    def test_finished_timestamp_survives_restart(self):
        self.item['fixture']['status']['short'] = 'FT'
        first = self.provider().fetch(NOW)
        second = self.provider().fetch(NOW + timedelta(seconds=120))
        self.assertEqual(first['finished_at'], second['finished_at'])

    def test_missing_key_is_error_not_demo(self):
        with patch.dict(os.environ, {'ARCHSPORT_API_KEY': ''}):
            with self.assertRaises(ProviderError):
                ApiFootball({'key_file': '/nonexistent/archsport-test-key'}, self.store)


class ScheduleTests(unittest.TestCase):
    def match(self, status, delta=0):
        match = normalize(copy.deepcopy(RAW))
        match.update(status=status, kickoff_utc=(NOW + timedelta(seconds=delta)).isoformat())
        return match

    def test_idle_30_minutes(self):
        self.assertEqual(poll_interval(None, NOW), 1800)

    def test_far_game_wakes_at_pre_game_window(self):
        self.assertEqual(poll_interval(self.match('scheduled', 1000), NOW), 100)

    def test_pre_game_2_minutes_and_kickoff_boundary(self):
        self.assertEqual(poll_interval(self.match('scheduled', 600), NOW), 120)
        self.assertEqual(poll_interval(self.match('scheduled', 30), NOW), 30)

    def test_live_bounds(self):
        for status in ('live', 'halftime', 'extra_time', 'penalties'):
            self.assertEqual(poll_interval(self.match(status), NOW, 30), 30)
            self.assertEqual(poll_interval(self.match(status), NOW, 1), 15)

    def test_finished_hides_after_5_minutes(self):
        match = self.match('finished')
        start = NOW.timestamp()
        self.assertEqual(poll_interval(match, NOW, finished_at=start), 60)
        self.assertTrue(match_visible(match, NOW, start))
        later = NOW + timedelta(seconds=300)
        self.assertEqual(poll_interval(match, later, finished_at=start), 1800)
        self.assertFalse(match_visible(match, later, start))


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.config = {'mode': 'live', 'team_name': 'Barcelona', 'poll_seconds': 60}
        self.current = normalize(copy.deepcopy(RAW))
        self.current.update(home_score=0, away_score=0, status='live')

    def tearDown(self):
        self.store.close()

    def worker(self):
        parent = self
        class Provider:
            def fetch(self):
                if isinstance(parent.current, Exception):
                    raise parent.current
                return copy.deepcopy(parent.current)
        return Worker(self.config, self.store, Provider())

    def test_reconnect_establishes_baseline_then_alerts_future_goal(self):
        worker = self.worker()
        worker.poll(NOW)
        self.current = ProviderError('offline')
        self.assertEqual(worker.poll(NOW + timedelta(seconds=20))['health'], 'error')
        self.current = normalize(copy.deepcopy(RAW))
        self.current.update(home_score=1, away_score=0, status='live')
        self.assertIsNone(worker.poll(NOW + timedelta(seconds=40))['alert'])
        self.current['home_score'] = 2
        self.assertEqual(worker.poll(NOW + timedelta(seconds=60))['alert']['kind'], 'score')

    def test_new_process_suppresses_catchup_and_restores_cache_on_error(self):
        self.worker().poll(NOW)
        self.current['home_score'] = 1
        self.assertIsNone(self.worker().poll(NOW + timedelta(seconds=20))['alert'])
        self.current = ProviderError('offline')
        payload = self.worker().poll(NOW + timedelta(seconds=30))
        self.assertEqual(payload['match']['home_score'], 1)
        self.assertEqual(payload['health'], 'error')

    def test_no_match_is_not_visible(self):
        self.current = None
        payload = self.worker().poll(NOW)
        self.assertFalse(payload['visible'])
        self.assertEqual(payload['next_poll_seconds'], 1800)
