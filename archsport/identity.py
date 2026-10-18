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
    if team_key(left.get('home')) != team_key(right.get('home')):
        return False
    if team_key(left.get('away')) != team_key(right.get('away')):
        return False
    left_time, right_time = utc_datetime(left.get('kickoff_utc')), utc_datetime(right.get('kickoff_utc'))
    return bool(left_time and right_time and abs((left_time - right_time).total_seconds()) <= tolerance_seconds)


def merge_source_ids(target, source):
    ids = dict(target.get('source_ids') or {})
    ids.update(source.get('source_ids') or {})
    return ids
