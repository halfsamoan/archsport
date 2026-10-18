import copy
import io
import json
import os
import tempfile
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
        event_calls = [params for path, params in self.calls if path == '/fixtures/events']
        team_fixture_calls = [params for path, params in self.calls
                              if path == '/fixtures' and 'team' in params]
        selected_fixture_calls = [params for path, params in self.calls
                                  if path == '/fixtures' and 'id' in params]
        self.assertEqual(event_calls, [])
        self.assertTrue(team_fixture_calls)
        self.assertTrue(all('season' in params for params in team_fixture_calls))
        self.assertIn('2029', [params['season'][0] for params in team_fixture_calls])
        self.assertEqual(len(selected_fixture_calls), 1)
        self.assertEqual(sum('next' in params for path, params in self.calls), 1)
        last_calls = [params for path, params in self.calls if 'last' in params]
        self.assertEqual(len(last_calls), 2)
        self.assertIn('2028', [params['season'][0] for params in last_calls])

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

    def test_free_season_restriction_switches_to_live_only_and_caches_the_limit(self):
        calls = []
        def opener(request, **kwargs):
            parsed = urlparse(request.full_url)
            params = parse_qs(parsed.query)
            calls.append((parsed.path, params))
            if params.get('live') == ['all']:
                other_team = copy.deepcopy(self.item)
                other_team['fixture']['id'] = 99
                other_team['teams']['home']['id'] = 1
                other_team['teams']['home']['name'] = 'Different Club'
                return Response(json.dumps({'errors': [], 'response': [other_team, self.item]}).encode())
            return Response(json.dumps({'errors': {'plan': 'Free plans do not have access to this season, try from 2022 to 2024.'},
                                        'response': []}).encode())
        provider = ApiFootball({'daily_budget': 100, 'team_id': 529,
                                'team_name': 'Barcelona', 'team_country': 'Spain'},
                              self.store, opener=opener)
        match = provider.fetch(NOW)
        self.assertEqual(match['status'], 'live')
        self.assertEqual(match['id'], str(self.item['fixture']['id']))
        self.assertTrue(provider.context['plan_limited'])
        provider.fetch(NOW + timedelta(seconds=60))
        self.assertEqual([params.get('live') for _, params in calls], [None, ['all'], ['all']])
        self.assertEqual(calls[1][1]['team'], ['529'])

    def test_rewriting_key_file_rechecks_cached_season_restriction(self):
        calls = []
        def opener(request, **kwargs):
            parsed = urlparse(request.full_url)
            params = parse_qs(parsed.query)
            calls.append(params)
            body = ({'errors': [], 'response': []} if params.get('live') == ['all'] else
                    {'errors': {'plan': 'Free plans do not have access to this season, try from 2022 to 2024.'},
                     'response': []})
            return Response(json.dumps(body).encode())

        with tempfile.TemporaryDirectory() as directory:
            key_file = Path(directory) / 'api-key'
            key_file.write_text('fake-first-key', encoding='utf-8')
            config = {'daily_budget': 100, 'team_id': 529, 'team_name': 'Barcelona',
                      'team_country': 'Spain', 'key_file': str(key_file), 'key_revision': 0}
            with patch.dict(os.environ, {'ARCHSPORT_API_KEY': ''}):
                ApiFootball(config, self.store, opener=opener).fetch(NOW)
                updated_ns = key_file.stat().st_mtime_ns + 1_000_000_000
                key_file.write_text('fake-second-key', encoding='utf-8')
                os.utime(key_file, ns=(updated_ns, updated_ns))
                ApiFootball(config, self.store, opener=opener).fetch(NOW + timedelta(minutes=1))
            self.assertEqual(sum(not params.get('live') for params in calls), 2)

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

    def test_idle_poll_wakes_for_two_hour_and_fifteen_minute_reminders(self):
        fixture = self.match('scheduled', 4 * 3600)
        self.assertEqual(poll_interval(None, NOW, upcoming_matches=[fixture]), 1800)
        fixture['kickoff_utc'] = (NOW + timedelta(hours=2)).isoformat()
        self.assertEqual(poll_interval(None, NOW, upcoming_matches=[fixture]), 1800)
        fixture['kickoff_utc'] = (NOW + timedelta(minutes=14)).isoformat()
        self.assertEqual(poll_interval(None, NOW, upcoming_matches=[fixture]), 120)

    def test_live_bounds(self):
        for status in ('live', 'halftime', 'extra_time', 'penalties'):
            self.assertEqual(poll_interval(self.match(status), NOW, 30), 300)
            self.assertEqual(poll_interval(self.match(status), NOW, 120), 300)
            self.assertEqual(poll_interval(self.match(status), NOW, 600), 600)

    def test_finished_fixture_is_not_visible(self):
        match = self.match('finished')
        start = NOW.timestamp()
        self.assertEqual(poll_interval(match, NOW, finished_at=start), 60)
        self.assertFalse(match_visible(match, NOW, start))
        later = NOW + timedelta(seconds=300)
        self.assertEqual(poll_interval(match, later, finished_at=start), 1800)
        self.assertFalse(match_visible(match, later, start))


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.config = {'mode': 'live', 'team_name': 'Barcelona', 'poll_seconds': 300}
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
        self.assertEqual(worker.poll(NOW + timedelta(seconds=300))['health'], 'error')
        self.current = normalize(copy.deepcopy(RAW))
        self.current.update(home_score=1, away_score=0, status='live')
        self.assertIsNone(worker.poll(NOW + timedelta(seconds=600))['alert'])
        self.current['home_score'] = 2
        self.assertEqual(worker.poll(NOW + timedelta(seconds=900))['alert']['kind'], 'score')

    def test_realistic_live_poll_gaps_preserve_score_alerts(self):
        for interval in (300, 600):
            with self.subTest(interval=interval):
                self.config['poll_seconds'] = interval
                self.current.update(home_score=0, away_score=0, status='live')
                worker = self.worker()
                worker.poll(NOW)
                self.current['home_score'] = 1
                payload = worker.poll(NOW + timedelta(seconds=interval))
                self.assertEqual(payload['alert']['kind'], 'score')
                self.assertEqual(payload['alert']['match_id'], payload['match']['id'])
                self.assertEqual(payload['alert']['kickoff_utc'], payload['match']['kickoff_utc'])
                self.assertEqual(payload['stale_after_seconds'], 2 * interval + 60)
                self.current['status'] = 'halftime'
                payload = worker.poll(NOW + timedelta(seconds=2 * interval))
                self.assertEqual(payload['alert']['kind'], 'status')

    def test_long_gap_after_cooldown_rebaselines(self):
        self.config['poll_seconds'] = 300
        worker = self.worker()
        worker.poll(NOW)
        self.current['home_score'] = 1
        payload = worker.poll(NOW + timedelta(seconds=3600))
        self.assertIsNone(payload['alert'])

    def test_poll_configuration_is_bounded_to_supported_live_intervals(self):
        from argparse import Namespace
        from archsport.__main__ import read_config

        args = Namespace(config=None, mode='live', team_name=None, team_country=None,
                         poll_seconds=30, daily_budget=None, watch_teams=None,
                         key_revision=0, demo=False, replay=None)
        self.assertEqual(read_config(args)['poll_seconds'], 300)
        args.poll_seconds = 900
        self.assertEqual(read_config(args)['poll_seconds'], 600)

    def test_provider_plan_restriction_uses_supplied_retry_interval(self):
        worker = self.worker()
        class Provider:
            def fetch(self):
                raise ProviderError('season unavailable', retry_seconds=24 * 60 * 60)
        worker.provider = Provider()
        payload = worker.poll(NOW)
        self.assertEqual(payload['next_poll_seconds'], 24 * 60 * 60)

        class LiveOnlyProvider:
            live_only = True
            warning = 'live only'
            def fetch(self):
                current = normalize(copy.deepcopy(RAW))
                current.update(home_score=0, away_score=0, status='live')
                return current
        worker.provider = LiveOnlyProvider()
        payload = worker.poll(NOW)
        self.assertEqual(payload['next_poll_seconds'], 300)

    def test_live_probe_interval_applies_when_no_fixture_is_returned(self):
        worker = self.worker()
        class ProbeProvider:
            context = {'upcoming_matches': []}
            live_only = True
            next_poll_seconds = 300
            def fetch(self):
                return []
        worker.provider = ProbeProvider()
        self.assertEqual(worker.poll(NOW)['next_poll_seconds'], 300)

    def test_live_provider_cooldown_preserves_fixture_wake_and_schedule_refresh(self):
        fixture = {'id': 'match:barcelona:sevilla:20300101', 'home': 'Barcelona', 'away': 'Sevilla',
                   'status': 'scheduled', 'kickoff_utc': (NOW + timedelta(minutes=90)).isoformat(),
                   'team_keys': ['barcelona', 'sevilla']}

        class CoolingProvider:
            context = {'upcoming_matches': [fixture], 'recent': []}
            live_only = True
            next_poll_seconds = 300
            retry_after_seconds = 24 * 60 * 60
            def fetch(self):
                return []

        worker = self.worker()
        worker.config['poll_seconds'] = 600
        worker.provider = CoolingProvider()
        payload = worker.poll(NOW)
        self.assertEqual(payload['next_poll_seconds'], 75 * 60)
        self.assertEqual(payload['alert']['kind'], 'kickoff')

        CoolingProvider.context = {'upcoming_matches': [], 'recent': []}
        payload = worker.poll(NOW + timedelta(minutes=1))
        self.assertEqual(payload['next_poll_seconds'], 6 * 60 * 60)

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

    def test_all_watched_live_matches_are_ingested_and_alert_selects_changed_team(self):
        barcelona = copy.deepcopy(self.current)
        barcelona['id'] = 'barcelona-live'
        lazio = copy.deepcopy(self.current)
        lazio.update(id='lazio-live', home='Lazio', away='Como', home_id=487, away_id=895,
                     team_keys=['lazio', 'como'])

        class MultiProvider:
            context = {'upcoming_matches': [], 'recent': []}
            matches = [barcelona, lazio]
            def fetch(self):
                return copy.deepcopy(self.matches)

        config = {'mode': 'live', 'team_name': 'Barcelona', 'watch_teams': ['Barcelona', 'Lazio', 'Como'],
                  'poll_seconds': 300}
        worker = Worker(config, self.store, MultiProvider())
        worker.poll(NOW)
        MultiProvider.matches[1]['home_score'] = 1
        payload = worker.poll(NOW + timedelta(seconds=300))
        self.assertEqual(payload['match']['id'], 'lazio-live')
        self.assertEqual(payload['alert']['kind'], 'score')
        self.assertEqual(len(self.store.latest_all()), 2)

    def test_kickoff_reminder_is_visible_once_and_not_a_persistent_match(self):
        fixture = {'id': 'match:barcelona:sevilla:20261018', 'home': 'Barcelona', 'away': 'Sevilla',
                   'home_score': None, 'away_score': None, 'status': 'scheduled',
                   'kickoff_utc': (NOW + timedelta(minutes=14)).isoformat(),
                   'team_keys': ['barcelona', 'sevilla'], 'source_ids': {'football_data': '22'}}

        class ScheduleProvider:
            context = {'upcoming': fixture, 'upcoming_matches': [fixture], 'recent': []}
            def load_context(self, now=None):
                return self.context
            def fetch(self):
                return []

        config = {'mode': 'live', 'team_name': 'Barcelona', 'watch_teams': ['Barcelona', 'Lazio', 'Como'],
                  'poll_seconds': 300}
        worker = Worker(config, self.store, ScheduleProvider())
        first = worker.poll(NOW)
        self.assertTrue(first['visible'])
        self.assertEqual(first['alert']['kind'], 'kickoff')
        self.assertEqual(first['alert']['title'], '15분 후 경기')
        second = worker.poll(NOW + timedelta(minutes=1))
        self.assertFalse(second['visible'])
        self.assertIsNone(second['alert'])

    def test_two_hour_kickoff_reminder(self):
        fixture = {'id': 'match:barcelona:sevilla:20261018', 'home': 'Barcelona', 'away': 'Sevilla',
                   'status': 'scheduled', 'kickoff_utc': (NOW + timedelta(hours=2)).isoformat(),
                   'team_keys': ['barcelona', 'sevilla']}

        class ScheduleProvider:
            context = {'upcoming_matches': [fixture]}
            def load_context(self, now=None):
                return self.context
            def fetch(self):
                return []

        config = {'mode': 'live', 'team_name': 'Barcelona', 'watch_teams': ['Barcelona', 'Lazio', 'Como'],
                  'poll_seconds': 300}
        payload = Worker(config, self.store, ScheduleProvider()).poll(NOW)
        self.assertEqual(payload['alert']['title'], '2시간 후 경기')
