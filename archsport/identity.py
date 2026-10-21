"""Provider-neutral match identity and safe cross-provider matching."""
from datetime import datetime, timezone
import re

from .teams import canonical_team, normalize_name


def utc_datetime(value):
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def team_key(name):
    canonical = canonical_team(name)
    if canonical:
        return canonical
    tokens = normalize_name(name).split()
    prefixes = {'fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'ud', 'rcd', 'ss'}
    suffixes = prefixes | {'cfc'}
    while tokens and tokens[0] in prefixes:
        tokens.pop(0)
    while tokens and tokens[-1] in suffixes:
        tokens.pop()
    return '-'.join(tokens) or 'unknown'


def match_id(home, away, kickoff_utc):
    kickoff = utc_datetime(kickoff_utc)
    day = kickoff.strftime('%Y%m%d') if kickoff else 'unknown-date'
    return f'match:{team_key(home)}:{team_key(away)}:{day}'


def same_fixture(left, right, tolerance_seconds=1200):
    left_time, right_time = utc_datetime(left.get('kickoff_utc')), utc_datetime(right.get('kickoff_utc'))
    if not (left_time and right_time and abs((left_time - right_time).total_seconds()) <= tolerance_seconds):
        return False
    same = {side: team_key(left.get(side)) == team_key(right.get(side)) for side in ('home', 'away')}
    # Providers spell opponents differently ('Club Atlético de Madrid' / 'Atletico Madrid'), but a
    # supported club on the same side at the same kickoff cannot be in another fixture.
    return all(same.values()) or any(same[side] and canonical_team(left.get(side)) for side in same)


def merge_source_ids(target, source):
    ids = dict(target.get('source_ids') or {})
    ids.update(source.get('source_ids') or {})
    return ids
