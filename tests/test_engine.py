import tempfile
import unittest
from pathlib import Path

from archsport.engine import Store


def match(home=1, away=0, status='live'):
    return dict(id='f1', home_score=home, away_score=away, status=status)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')

    def tearDown(self):
        self.store.close()

    def test_first_snapshot_is_not_a_goal(self):
        self.assertIsNone(self.store.ingest(match(), 0))

    def test_goal_and_duplicate(self):
        self.store.ingest(match(), 0)
        self.assertEqual(self.store.ingest(match(2), 30)['kind'], 'score')
        self.assertIsNone(self.store.ingest(match(2), 60))

    def test_var_and_repeated_legitimate_goal(self):
        self.store.ingest(match(), 0)
        first = self.store.ingest(match(2), 30)
        self.assertEqual(self.store.ingest(match(), 60)['kind'], 'correction')
        second = self.store.ingest(match(2), 90)
        self.assertNotEqual(first['fingerprint'], second['fingerprint'])

    def test_default_gap_rebaselines_after_120s(self):
        self.store.ingest(match(), 0)
        self.assertIsNone(self.store.ingest(match(4), 300))

    def test_configured_poll_gap_allows_score_alert(self):
        self.store.ingest(match(), 0)
        self.assertEqual(self.store.ingest(match(2), 300, max_gap_seconds=660)['kind'], 'score')

    def test_null_is_not_zero_or_goal(self):
        self.store.ingest(match(None, None, 'scheduled'), 0)
        result = self.store.ingest(match(0, 0, 'live'), 30)
        self.assertEqual(result['kind'], 'status')

    def test_finish_once(self):
        self.store.ingest(match(), 0)
        self.assertEqual(self.store.ingest(match(status='finished'), 30)['title'], '경기 종료')
        self.assertIsNone(self.store.ingest(match(status='finished'), 60))

    def test_budget_blocks_before_request_and_resets_by_day(self):
        self.assertTrue(self.store.reserve_request(1, '2026-10-17'))
        self.assertFalse(self.store.reserve_request(1, '2026-10-17'))
        self.assertTrue(self.store.reserve_request(1, '2026-10-18'))

    def test_reopen_preserves_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.db'
            first = Store(path)
            first.ingest(match(), 0)
            first.ingest(match(2), 30)
            first.close()
            second = Store(path)
            self.assertIsNone(second.ingest(match(2), 60))
            second.close()

    def test_catchup_includes_normal_penalty_and_own_goals(self):
        for index, detail in enumerate(('Normal Goal', 'Penalty', 'Own Goal')):
            with self.subTest(detail=detail):
                previous = {'id': f'goal-{index}', 'home': 'Barcelona', 'away': 'Sevilla',
                            'home_score': 0, 'away_score': 0, 'status': 'live', 'elapsed': 1}
                current = {**previous, 'home_score': 1, 'elapsed': 20,
                           'events': [{'kind': 'Goal', 'detail': detail, 'elapsed': 18,
                                       'player': 'Scorer', 'team': 'Barcelona'}]}
                self.store.ingest(previous, index * 1000)
                alert = self.store.ingest(current, index * 1000 + 300,
                                          suppress=True, catchup=True)
                self.assertEqual(alert['kind'], 'score')

    def test_catchup_first_half_age_includes_halftime(self):
        previous = {'id': 'halftime-goal', 'home': 'Barcelona', 'away': 'Sevilla',
                    'home_score': 0, 'away_score': 0, 'status': 'live', 'elapsed': 1}
        current = {**previous, 'home_score': 1, 'elapsed': 50,
                   'events': [{'kind': 'Goal', 'detail': 'Normal Goal', 'elapsed': 45,
                               'player': 'Scorer', 'team': 'Barcelona'}]}
        self.store.ingest(previous, 0)
        self.assertIsNone(self.store.ingest(current, 15 * 60,
                                            suppress=True, catchup=True))


if __name__ == '__main__':
    unittest.main()
