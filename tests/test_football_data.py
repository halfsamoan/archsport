import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from archsport.engine import Store
from archsport.football_data import FootballDataSchedule, date_windows
from archsport.identity import same_fixture
from archsport.provider import ApiFootballLive
from archsport.teams import canonical_team, normalize_watch_list


NOW = datetime(2026, 10, 18, 15, tzinfo=timezone.utc)


class Response(io.BytesIO):
    status = 200
    headers = {}


def fd_match(identifier, home, away, kickoff, code, status='TIMED', goals=(None, None)):
    return {'id': identifier, 'utcDate': kickoff, 'status': status,
            'competition': {'code': code, 'name': {'PD': 'LaLiga', 'SA': 'Serie A', 'CL': 'Champions League'}.get(code, 'Cup')},
            'homeTeam': {'id': identifier + 10, 'name': home},
            'awayTeam': {'id': identifier + 20, 'name': away},
            'score': {'fullTime': {'home': goals[0], 'away': goals[1]}}}


class FootballDataTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.tmp = tempfile.TemporaryDirectory()
        self.key_file = Path(self.tmp.name) / 'football-data-token'
        self.key_file.write_text('private-test-token', encoding='utf-8')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_windows_are_seven_days_and_cover_schedule_and_recent_results(self):
        windows = date_windows(NOW.date())
        self.assertLessEqual(windows[0][0], NOW.date() - timedelta(days=28))
        self.assertGreaterEqual(windows[-1][1], NOW.date() + timedelta(days=28))
        self.assertEqual(len(windows), 9)
        self.assertTrue(all((end - start).days == 6 for start, end in windows))
        self.assertEqual(windows[0][0].weekday(), 0)
        self.assertEqual(windows[-1][1].weekday(), 6)
        self.assertEqual(date_windows(NOW.date() + timedelta(days=1)),
                         date_windows(NOW.date() + timedelta(days=2)))

    def test_three_team_schedule_normalizes_and_caches_without_details(self):
        rows = [
            fd_match(100, 'FC Barcelona', 'Sevilla FC', '2026-10-20T19:00:00Z', 'PD'),
            fd_match(101, 'Como 1907', 'SS Lazio', '2026-10-22T18:00:00Z', 'SA'),
            fd_match(102, 'Como', 'Torino FC', '2026-10-15T18:00:00Z', 'SA', 'FINISHED', (2, 1)),
            fd_match(103, 'Real Madrid CF', 'Valencia CF', '2026-10-20T18:00:00Z', 'PD'),
            fd_match(104, 'Barcelona', 'Lazio', '2026-10-20T19:00:00Z', 'CUP'),
        ]
        calls = []

        def opener(request, **kwargs):
            calls.append(request)
            return Response(json.dumps({'matches': rows}).encode())

        schedule = FootballDataSchedule({'football_data_key_file': str(self.key_file)}, self.store, opener)
        context = schedule.fetch_context(NOW)
        self.assertEqual(len(calls), len(date_windows(NOW.date())))
        self.assertEqual(calls[0].get_header('X-auth-token'), 'private-test-token')
        params = parse_qs(urlparse(calls[0].full_url).query)
        self.assertEqual(params['competitions'], ['PD,SA,CL'])
        self.assertEqual((datetime.fromisoformat(params['dateTo'][0]) -
                          datetime.fromisoformat(params['dateFrom'][0])).days, 7)
        self.assertEqual({fixture['id'] for fixture in context['upcoming_matches']},
                         {'match:barcelona:sevilla:20261020', 'match:como:lazio:20261022'})
        self.assertEqual(context['recent'][0]['home_score'], 2)
        self.assertIsNone(context['recent_stats'])
        self.assertFalse(context['stats_available'])
        self.assertIn('세부 스탯', context['schedule_notice'])
        self.assertIn('컵 대회', context['schedule_notice'])
        schedule.fetch_context(NOW + timedelta(minutes=5))
        self.assertEqual(len(calls), len(date_windows(NOW.date())))

    def test_overlapping_window_rows_are_deduplicated_by_provider_id(self):
        duplicate = fd_match(100, 'FC Barcelona', 'Sevilla FC',
                             '2026-10-20T19:00:00Z', 'PD')
        calls = 0

        def opener(request, **kwargs):
            nonlocal calls
            calls += 1
            # The same provider fixture may be returned by adjacent windows.
            return Response(json.dumps({'matches': [duplicate, duplicate]}).encode())

        schedule = FootballDataSchedule({'football_data_key_file': str(self.key_file)},
                                        self.store, opener)
        schedule.fetch_context(NOW)
        self.assertEqual(len(schedule.matches), 1)
        self.assertGreater(calls, 1)

    def test_week_aligned_windows_reuse_cache_keys_across_days(self):
        def opener(request, **kwargs):
            return Response(b'{"matches": []}')

        schedule = FootballDataSchedule({'football_data_key_file': str(self.key_file)}, self.store,
                                        opener)
        base = NOW + timedelta(days=2)
        schedule.fetch_context(base)
        first_keys = {key for (key,) in self.store.db.execute(
            "SELECT key FROM cache WHERE key LIKE 'football-data:%'")}
        later = base + timedelta(days=1)
        schedule.fetch_context(later)
        keys = {key for (key,) in self.store.db.execute("SELECT key FROM cache WHERE key LIKE 'football-data:%'")}
        self.assertEqual(first_keys, keys)
        self.assertEqual(keys, {f'football-data:{start.isoformat()}:{end.isoformat()}'
                                for start, end in date_windows(later.date())})

    def test_failed_refresh_does_not_prune_schedule_cache(self):
        stale_key = 'football-data:old-window'
        self.store.cache_set(stale_key, {'at': 0, 'matches': []})

        def fail(*_args, **_kwargs):
            from urllib.error import URLError
            raise URLError('offline')

        schedule = FootballDataSchedule({'football_data_key_file': str(self.key_file)},
                                        self.store, fail)
        schedule.fetch_context(NOW)
        self.assertEqual(self.store.cache_get(stale_key), {'at': 0, 'matches': []})
        self.assertTrue(schedule.warning)

    def test_watched_fixture_survives_a_refresh_that_briefly_drops_it(self):
        # 2026-10-21: the free feed served an old list without PSG–Barcelona hours before
        # kickoff; the remembered fixture must still drive the reminder and the live probe.
        kickoff = NOW + timedelta(hours=8)
        fixture = fd_match(300, 'Paris Saint-Germain FC', 'FC Barcelona',
                           kickoff.strftime('%Y-%m-%dT%H:%M:%SZ'), 'CL')
        responses = [[fixture], []]

        def opener(request, **kwargs):
            return Response(json.dumps({'matches': responses[0]}).encode())

        schedule = FootballDataSchedule({'football_data_key_file': str(self.key_file)}, self.store, opener)
        first = schedule.fetch_context(NOW)
        self.assertEqual(len(first['upcoming_matches']), 1)
        responses.pop(0)
        # Past the six-hour cache, so every window refetches and the fixture is gone upstream.
        context = schedule.fetch_context(NOW + timedelta(hours=6, minutes=5))
        self.assertEqual([item['home'] for item in context['upcoming_matches']], ['Paris Saint-Germain FC'])
        self.assertTrue(schedule.matches[0]['schedule_missing'])
        self.assertEqual(schedule.matches[0]['status'], 'scheduled')
        # Three hours after kickoff a missing fixture is no longer kept.
        schedule.fetch_context(kickoff + timedelta(hours=3, minutes=1))
        self.assertEqual(schedule.matches, [])

    def test_window_refreshes_every_half_hour_until_a_watched_result_arrives(self):
        kickoff = NOW - timedelta(hours=2)
        stamp = kickoff.strftime('%Y-%m-%dT%H:%M:%SZ')
        rows = [fd_match(301, 'Paris Saint-Germain FC', 'FC Barcelona', stamp, 'CL')]
        calls = []

        def opener(request, **kwargs):
            calls.append(request)
            return Response(json.dumps({'matches': rows}).encode())

        schedule = FootballDataSchedule({'football_data_key_file': str(self.key_file)}, self.store, opener)
        pending = schedule.fetch_context(NOW)['recent'][0]
        self.assertTrue(pending['result_pending'])
        self.assertEqual(pending['away'], 'FC Barcelona')
        full = len(calls)
        schedule.fetch_context(NOW + timedelta(minutes=10))
        self.assertEqual(len(calls), full)  # still fresh
        schedule.fetch_context(NOW + timedelta(minutes=31))
        self.assertGreater(len(calls), full)  # the window holding the unfinished match refetched
        rows[0] = fd_match(301, 'Paris Saint-Germain FC', 'FC Barcelona', stamp, 'CL', 'FINISHED', (4, 2))
        schedule.fetch_context(NOW + timedelta(minutes=62))
        settled = len(calls)
        context = schedule.fetch_context(NOW + timedelta(minutes=95))
        self.assertEqual(len(calls), settled)  # result in: back to the six-hour cache
        self.assertEqual(context['recent'][0]['away_score'], 2)
        self.assertNotIn('result_pending', context['recent'][0])

    def test_team_aliases_and_provider_neutral_fixture_match(self):
        self.assertEqual(canonical_team('FC Barcelona'), 'barcelona')
        self.assertEqual(canonical_team('SS Lazio'), 'lazio')
        self.assertEqual(canonical_team('Como 1907'), 'como')
        watched = normalize_watch_list(['Barcelona', 'Lazio', 'Como'])
        self.assertEqual(watched, ['barcelona', 'lazio', 'como'])
        left = {'home': 'FC Barcelona', 'away': 'Sevilla FC', 'kickoff_utc': '2026-10-20T19:00:00Z'}
        right = {'home': 'Barcelona', 'away': 'Sevilla', 'kickoff_utc': '2026-10-20T19:15:00Z'}
        self.assertTrue(same_fixture(left, right))
        # Opponent spellings differ between providers; a watched club on the same side decides.
        fd = {'home': 'Club Atlético de Madrid', 'away': 'FC Barcelona', 'kickoff_utc': '2026-11-08T20:00:00Z'}
        api = {'home': 'Atletico Madrid', 'away': 'Barcelona', 'kickoff_utc': '2026-11-08T20:00:00Z'}
        self.assertTrue(same_fixture(fd, api))
        self.assertFalse(same_fixture(fd, {**api, 'home': 'Barcelona', 'away': 'Atletico Madrid'}))
        self.assertFalse(same_fixture({**fd, 'away': 'Sevilla FC'}, {**api, 'away': 'Sevilla'}))


class ApiFootballMultiTeamTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.tmp = tempfile.TemporaryDirectory()
        self.key_file = Path(self.tmp.name) / 'api-key'
        self.key_file.write_text('api-test-token', encoding='utf-8')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def fixture(self, identifier, home, away, kickoff, score=(0, 0)):
        return {'fixture': {'id': identifier, 'date': kickoff,
                            'status': {'short': '1H', 'elapsed': 21}},
                'teams': {'home': {'id': identifier + 1, 'name': home},
                          'away': {'id': identifier + 2, 'name': away}},
                'goals': {'home': score[0], 'away': score[1]}, 'score': {},
                'league': {'name': 'Serie A'}}

    def test_live_feed_tracks_each_watched_team_and_matches_schedule_id(self):
        fixture = self.fixture(5, 'Barcelona', 'Sevilla', '2026-10-20T19:00:00Z')
        ignored = self.fixture(6, 'Arsenal', 'Chelsea', '2026-10-20T19:00:00Z')
        bodies = [{'errors': [], 'response': [fixture, ignored]}]
        requests = []

        def opener(request, **kwargs):
            requests.append(request)
            return Response(json.dumps(bodies.pop(0)).encode())

        provider = ApiFootballLive({'daily_budget': 100, 'key_file': str(self.key_file),
                                    'watch_teams': ['Barcelona', 'Lazio', 'Como']}, self.store, opener)
        scheduled = [{'id': 'match:barcelona:sevilla:20261020',
                      'home': 'FC Barcelona', 'away': 'Sevilla',
                      'kickoff_utc': '2026-10-20T19:00:00Z',
                      'source_ids': {'football_data': '88'}}]
        matches = provider.fetch(NOW, scheduled)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['id'], scheduled[0]['id'])
        self.assertEqual(matches[0]['source_ids'], {'api_football': '5', 'football_data': '88'})
        self.assertEqual(parse_qs(urlparse(requests[0].full_url).query), {'live': ['all']})

    def test_changed_fixture_fetches_events_using_provider_id(self):
        original = self.fixture(55, 'SS Lazio', 'Como', '2026-10-21T18:00:00Z')
        changed = self.fixture(55, 'SS Lazio', 'Como', '2026-10-21T18:00:00Z', (1, 0))
        bodies = [{'errors': [], 'response': [original]}, {'errors': [], 'response': [changed]},
                  {'errors': [], 'response': [{'type': 'Goal', 'detail': 'Normal Goal',
                     'time': {'elapsed': 21}, 'player': {'name': 'Player'},
                     'team': {'name': 'SS Lazio'}}]}]
        requests = []

        def opener(request, **kwargs):
            requests.append(request)
            return Response(json.dumps(bodies.pop(0)).encode())

        provider = ApiFootballLive({'daily_budget': 100, 'key_file': str(self.key_file),
                                    'watch_teams': ['Barcelona', 'Lazio', 'Como']}, self.store, opener)
        provider.fetch(NOW)
        result = provider.fetch(NOW + timedelta(minutes=3))
        self.assertEqual(result[0]['events'][0]['player'], 'Player')
        self.assertEqual(parse_qs(urlparse(requests[-1].full_url).query), {'fixture': ['55']})
        # Later polls without a change keep the scorer line, at no extra request.
        bodies.append({'errors': [], 'response': [changed]})
        unchanged = provider.fetch(NOW + timedelta(minutes=8))
        self.assertEqual(unchanged[0]['events'][0]['player'], 'Player')
        self.assertEqual(len(requests), 4)

    def test_match_leaving_live_feed_is_read_once_by_id_for_its_final_score(self):
        live = self.fixture(77, 'Atletico Madrid', 'Barcelona', '2026-11-08T20:00:00Z', (1, 1))
        live['fixture']['status'] = {'short': '2H', 'elapsed': 88}
        final = self.fixture(77, 'Atletico Madrid', 'Barcelona', '2026-11-08T20:00:00Z', (1, 2))
        final['fixture']['status'] = {'short': 'FT', 'elapsed': 90}
        final['events'] = [{'type': 'Goal', 'detail': 'Normal Goal', 'time': {'elapsed': 90, 'extra': 3},
                            'player': {'name': 'Late Scorer'}, 'team': {'name': 'Barcelona'}}]
        feeds = [[live], [], []]
        requests = []

        def opener(request, **kwargs):
            params = parse_qs(urlparse(request.full_url).query)
            requests.append(params)
            body = feeds.pop(0) if 'live' in params else [final] if 'id' in params else self.fail(params)
            return Response(json.dumps({'errors': [], 'response': body}).encode())

        provider = ApiFootballLive({'daily_budget': 100, 'key_file': str(self.key_file),
                                    'watch_teams': ['Barcelona']}, self.store, opener)
        scheduled = [{'id': 'match:club-atletico-de-madrid:barcelona:20261108',
                      'home': 'Club Atlético de Madrid', 'away': 'FC Barcelona',
                      'kickoff_utc': '2026-11-08T20:00:00Z', 'source_ids': {'football_data': '9'}}]
        at = datetime(2026, 11, 8, 21, 40, tzinfo=timezone.utc)
        self.assertEqual(provider.fetch(at, scheduled)[0]['status'], 'live')
        ended = provider.fetch(at + timedelta(minutes=5), scheduled)
        self.assertEqual([(m['status'], m['home_score'], m['away_score']) for m in ended], [('finished', 1, 2)])
        self.assertEqual(ended[0]['id'], scheduled[0]['id'])
        self.assertEqual(ended[0]['events'][0]['player'], 'Late Scorer')
        self.assertEqual(provider.fetch(at + timedelta(minutes=10), scheduled), [])
        # live=all three times, one id lookup, and no separate events request.
        self.assertEqual([sorted(params) for params in requests], [['live'], ['live'], ['id'], ['live']])


if __name__ == '__main__':
    unittest.main()
