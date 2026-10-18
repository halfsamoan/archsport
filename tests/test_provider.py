import io
import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from archsport.engine import Store
from archsport.provider import ApiFootball, ProviderError, normalize, seconds_until_utc_reset


class Response(io.BytesIO):
    headers = {}


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.env = patch.dict(os.environ, {'ARCHSPORT_API_KEY': 'test-key-never-real'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.store.close()

    def provider(self, body):
        return ApiFootball({'daily_budget': 2}, self.store,
                           opener=lambda *a, **k: Response(json.dumps(body).encode()))

    def test_http_200_errors_are_errors(self):
        with self.assertRaises(ProviderError):
            self.provider({'errors': {'token': 'invalid'}, 'response': []}).get('fixtures')

    def test_free_plan_season_rejection_waits_before_retry(self):
        with self.assertRaises(ProviderError) as caught:
            self.provider({'errors': {'plan': 'Free plans do not have access to this season, try from 2022 to 2024.'},
                           'response': []}).get('fixtures')
        self.assertEqual(caught.exception.retry_seconds, 24 * 60 * 60)
        self.assertIn('무료 API 요금제', str(caught.exception))

    def test_request_quota_retries_after_utc_reset(self):
        expected = seconds_until_utc_reset(datetime(2026, 10, 18, 23, 59, 58,
                                                     tzinfo=timezone.utc))
        self.assertEqual(expected, 7)
        provider = self.provider({'errors': [], 'response': []})
        provider.remaining = 0
        with self.assertRaises(ProviderError) as caught:
            provider.get('fixtures')
        self.assertGreater(caught.exception.retry_seconds, 0)
        self.assertLessEqual(caught.exception.retry_seconds, 24 * 60 * 60 + 5)

    def test_local_budget_retries_after_utc_reset(self):
        provider = ApiFootball({'daily_budget': 0}, self.store,
                               opener=lambda *a, **k: self.fail('quota rejection must not call API'))
        with self.assertRaises(ProviderError) as caught:
            provider.get('fixtures')
        self.assertGreater(caught.exception.retry_seconds, 0)
        self.assertLessEqual(caught.exception.retry_seconds, 24 * 60 * 60 + 5)

    def test_pagination_not_silently_truncated(self):
        with self.assertRaises(ProviderError):
            self.provider({'response': [], 'paging': {'total': 2}}).get('fixtures')

    def test_empty_success(self):
        self.assertEqual(self.provider({'errors': [], 'response': []}).get('fixtures'), [])

    def test_penalties_and_unknown_status_preserved(self):
        item = {'fixture': {'id': 1, 'date': '2026-10-17T20:00:00Z',
                            'status': {'short': 'NEW', 'elapsed': None}},
                'teams': {'home': {'name': 'Barcelona'}, 'away': {'name': 'Example'}},
                'goals': {'home': None, 'away': None},
                'score': {'penalty': {'home': 4, 'away': 3}}, 'league': {'name': 'Cup'}}
        value = normalize(item)
        self.assertIsNone(value['home_score'])
        self.assertEqual(value['home_penalties'], 4)
        self.assertEqual(value['status'], 'unknown')
        self.assertEqual(value['provider_status'], 'NEW')
