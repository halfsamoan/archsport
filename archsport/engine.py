"""Durable snapshot transitions. No network or desktop dependencies."""
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


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

    def latest(self):
        row = self.db.execute('SELECT payload,seen_at FROM snapshots ORDER BY seen_at DESC LIMIT 1').fetchone()
        return (json.loads(row[0]), row[1]) if row else (None, None)

    def ingest(self, match, now, suppress=False, max_gap_seconds=120):
        row = self.db.execute('SELECT payload, seen_at, revision FROM snapshots WHERE match_id=?',
                              (match['id'],)).fetchone()
        alert = None
        revision = 0 if row is None else row[2]
        previous = json.loads(row[0]) if row else None
        # First fetch or a long gap establishes a baseline, without replaying goals.
        if previous and not suppress and 0 <= now - row[1] <= max(0, int(max_gap_seconds)):
            old = (previous.get('home_score'), previous.get('away_score'))
            new = (match.get('home_score'), match.get('away_score'))
            if all(isinstance(x, int) for x in old + new) and old != new:
                correction = any(b < a for a, b in zip(old, new))
                alert = {'kind': 'correction' if correction else 'score',
                         'title': '스코어 정정' if correction else '스코어 변경'}
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
        if alert:
            # Revision distinguishes a legitimate repeated score after a VAR reversal.
            fingerprint = hashlib.sha256(json.dumps(
                [match['id'], revision, core(match)], ensure_ascii=False).encode()).hexdigest()
            alert['fingerprint'] = fingerprint
        with self.db:
            if alert:
                inserted = self.db.execute('INSERT OR IGNORE INTO receipts VALUES (?,?)',
                                           (match['id'], alert['fingerprint'])).rowcount
                if not inserted:
                    alert = None
            self.db.execute('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)',
                            (match['id'], json.dumps(match, ensure_ascii=False), now, revision))
        return alert

    def close(self):
        self.db.close()
