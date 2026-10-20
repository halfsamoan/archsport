"""Durable snapshot transitions. No network or desktop dependencies."""
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .teams import canonical_team, normalize_name


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def _score_events(match):
    """Return provider goal events grouped by the side credited with the goal."""
    home = canonical_team(match.get('home')) or normalize_name(match.get('home'))
    away = canonical_team(match.get('away')) or normalize_name(match.get('away'))
    grouped = {'home': [], 'away': []}
    occurrences = {}
    for index, event in enumerate(match.get('events') or []):
        if not isinstance(event, dict) or str(event.get('kind', '')).casefold() != 'goal':
            continue
        detail = str(event.get('detail', '')).casefold()
        if any(value in detail for value in ('miss', 'shootout', 'cancel', 'disallow')):
            continue
        team = str(event.get('team') or '')
        team_key = canonical_team(team) or normalize_name(team)
        side = 'home' if team_key == home else 'away' if team_key == away else None
        if not side:
            continue
        elapsed = event.get('elapsed')
        extra = event.get('extra')
        player = str(event.get('player') or '')
        signature = [side, detail, elapsed, extra, normalize_name(player)]
        signature_key = json.dumps(signature, ensure_ascii=False, separators=(',', ':'))
        occurrence = occurrences.get(signature_key, 0)
        occurrences[signature_key] = occurrence + 1
        fingerprint = 'goal:' + hashlib.sha256(json.dumps(
            [match.get('id'), signature, occurrence], ensure_ascii=False,
            separators=(',', ':')).encode()).hexdigest()
        try:
            minute = int(elapsed)
        except (TypeError, ValueError, OverflowError):
            minute = None
        try:
            added = int(extra) if extra is not None else 0
        except (TypeError, ValueError, OverflowError):
            added = 0
        grouped[side].append({'event': event, 'fingerprint': fingerprint,
                              'minute': minute, 'sort': (minute is not None,
                                                         minute if minute is not None else index,
                                                         added, index)})
    for events in grouped.values():
        events.sort(key=lambda item: item['sort'])
    return grouped


def _new_scoring_goals(previous, match):
    old = (previous.get('home_score'), previous.get('away_score'))
    new = (match.get('home_score'), match.get('away_score'))
    if not all(isinstance(value, int) for value in old + new):
        return []
    if any(after < before for before, after in zip(old, new)):
        return []
    grouped = _score_events(match)
    result = []
    for side, before, after in zip(('home', 'away'), old, new):
        delta = after - before
        if not delta:
            continue
        events = grouped[side]
        # If provider events cannot account for the current score, do not guess
        # which event belongs to the gap after the stored observation.
        if len(events) < after:
            return []
        result.extend(events[-delta:])
    return sorted(result, key=lambda item: item['sort'])


def _catchup_goal_is_recent(goal, match, now, previous_seen):
    observed_gap = now - previous_seen
    if 0 <= observed_gap <= 600:
        return True
    goal_minute = goal.get('minute')
    current_minute = match.get('elapsed')
    if not isinstance(goal_minute, int):
        return False
    try:
        current_minute = int(current_minute)
    except (TypeError, ValueError, OverflowError):
        return False
    age_minutes = current_minute - goal_minute
    after_halftime = (match.get('status') in ('halftime', 'extra_time', 'penalties', 'finished')
                      or current_minute > 45)
    if goal_minute <= 45 and after_halftime:
        age_minutes += 15
    return 0 <= age_minutes <= 10


class Store:
    def __init__(self, path):
        if str(path) != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path))
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS snapshots (
                match_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                seen_at REAL NOT NULL, revision INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS receipts (
                match_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                PRIMARY KEY(match_id, fingerprint));
            CREATE TABLE IF NOT EXISTS requests (
                day TEXT PRIMARY KEY, count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS provider_requests (
                provider TEXT NOT NULL, requested_at REAL NOT NULL);
        ''')

    def reserve_request(self, budget, day=None):
        day = day or datetime.now(timezone.utc).date().isoformat()
        # Reserve before I/O, including failed requests. One serialized worker.
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO requests VALUES (?, 0)', (day,))
            cursor = self.db.execute(
                'UPDATE requests SET count=count+1 WHERE day=? AND count<?',
                (day, budget))
            return cursor.rowcount == 1

    def cache_get(self, key, default=None):
        row = self.db.execute('SELECT payload FROM cache WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def cache_set(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO cache VALUES (?,?)',
                            (key, json.dumps(value, ensure_ascii=False)))

    def cache_prune(self, prefix, keep):
        """Delete cache rows under prefix except the keys still in use."""
        keep = list(keep)
        with self.db:
            self.db.execute('DELETE FROM cache WHERE substr(key, 1, ?)=? AND key NOT IN (%s)'
                            % ','.join('?' * len(keep)), (len(prefix), prefix, *keep))

    def reserve_rate_limit(self, provider, limit, window_seconds, now):
        """Durably cap a provider's calls across worker restarts."""
        with self.db:
            self.db.execute('DELETE FROM provider_requests WHERE provider=? AND requested_at<=?',
                            (provider, now - window_seconds))
            row = self.db.execute('SELECT COUNT(*), MIN(requested_at) FROM provider_requests WHERE provider=?',
                                  (provider,)).fetchone()
            if row[0] >= limit:
                return max(1, int(row[1] + window_seconds - now + 1))
            self.db.execute('INSERT INTO provider_requests VALUES (?,?)', (provider, now))
        return None

    def latest_all(self, limit=30):
        rows = self.db.execute('SELECT payload,seen_at FROM snapshots ORDER BY seen_at DESC LIMIT ?',
                               (max(1, int(limit)),)).fetchall()
        return [(json.loads(payload), seen_at) for payload, seen_at in rows]

    def insert_receipt(self, match_id, fingerprint):
        with self.db:
            inserted = self.db.execute('INSERT OR IGNORE INTO receipts VALUES (?,?)',
                                       (match_id, fingerprint)).rowcount
        return bool(inserted)

    def has_receipt(self, match_id, fingerprint):
        return self.db.execute('SELECT 1 FROM receipts WHERE match_id=? AND fingerprint=?',
                               (match_id, fingerprint)).fetchone() is not None

    def latest(self):
        row = self.db.execute('SELECT payload,seen_at FROM snapshots ORDER BY seen_at DESC LIMIT 1').fetchone()
        return (json.loads(row[0]), row[1]) if row else (None, None)

    def ingest(self, match, now, suppress=False, max_gap_seconds=120, catchup=False):
        row = self.db.execute('SELECT payload, seen_at, revision FROM snapshots WHERE match_id=?',
                              (match['id'],)).fetchone()
        alert = None
        alert_fingerprint = None
        goal_receipts = []
        revision = 0 if row is None else row[2]
        previous = json.loads(row[0]) if row else None
        if catchup and previous:
            goals = _new_scoring_goals(previous, match)
            goal_receipts = [goal['fingerprint'] for goal in goals]
            recent = [goal for goal in goals
                      if _catchup_goal_is_recent(goal, match, now, row[1])
                      and not self.has_receipt(match['id'], goal['fingerprint'])]
            if recent:
                latest = recent[-1]
                alert = {'kind': 'score', 'title': '스코어 변경'}
                alert_fingerprint = latest['fingerprint']
        # First fetch or a long gap establishes a baseline, without replaying goals.
        if (not catchup and previous and not suppress and
                0 <= now - row[1] <= max(0, int(max_gap_seconds))):
            old = (previous.get('home_score'), previous.get('away_score'))
            new = (match.get('home_score'), match.get('away_score'))
            if all(isinstance(x, int) for x in old + new) and old != new:
                correction = any(b < a for a, b in zip(old, new))
                alert = {'kind': 'correction' if correction else 'score',
                         'title': '스코어 정정' if correction else '스코어 변경'}
                if not correction:
                    goal_receipts = [goal['fingerprint'] for goal in _new_scoring_goals(previous, match)]
            elif previous['status'] != match['status']:
                if match['status'] in ('live', 'halftime', 'extra_time', 'penalties', 'finished'):
                    alert = {'kind': 'status', 'title': {
                        'live': '경기 진행', 'halftime': '하프타임',
                        'extra_time': '연장전', 'penalties': '승부차기',
                        'finished': '경기 종료'}[match['status']]}
        core = lambda m: (m.get('home_score'), m.get('away_score'), m.get('status'),
                          m.get('home_penalties'), m.get('away_penalties'))
        changed = previous is None or core(previous) != core(match)
        revision += int(changed)
        if alert and alert_fingerprint is None:
            # Revision distinguishes a legitimate repeated score after a VAR reversal.
            fingerprint = hashlib.sha256(json.dumps(
                [match['id'], revision, core(match)], ensure_ascii=False).encode()).hexdigest()
            alert_fingerprint = fingerprint
        if alert:
            alert['fingerprint'] = alert_fingerprint
        with self.db:
            inserted_catchup_alert = False
            for fingerprint in dict.fromkeys(goal_receipts):
                inserted = self.db.execute('INSERT OR IGNORE INTO receipts VALUES (?,?)',
                                           (match['id'], fingerprint)).rowcount
                inserted_catchup_alert = (inserted_catchup_alert or
                                           fingerprint == alert_fingerprint and bool(inserted))
            if alert:
                if alert_fingerprint.startswith('goal:'):
                    if not inserted_catchup_alert:
                        alert = None
                else:
                    inserted = self.db.execute('INSERT OR IGNORE INTO receipts VALUES (?,?)',
                                               (match['id'], alert_fingerprint)).rowcount
                    if not inserted:
                        alert = None
            self.db.execute('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)',
                            (match['id'], json.dumps(match, ensure_ascii=False), now, revision))
        return alert

    def close(self):
        self.db.close()
