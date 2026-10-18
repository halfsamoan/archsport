"""Pure scheduling policy; seconds, UTC aware datetimes, no network."""
from datetime import datetime


def kickoff_time(match):
    value = match.get('kickoff_utc') if match else None
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def _fixture_wake_seconds(fixtures, now):
    waits = []
    for fixture in fixtures or ():
        if fixture.get('status') != 'scheduled':
            continue
        kickoff = kickoff_time(fixture)
        if not kickoff:
            continue
        remaining = (kickoff - now).total_seconds()
        if remaining > 7200:
            wait = remaining - 7200
        elif remaining > 900:
            wait = remaining - 900
        elif remaining > 0:
            wait = min(120, remaining)
        else:
            continue
        waits.append(max(15, int(wait)))
    return min(waits) if waits else None


def schedule_wake_seconds(fixtures, now):
    """Seconds until the next 2h/15m kickoff reminder check, or None."""
    return _fixture_wake_seconds(fixtures, now)


def poll_interval(match, now, live_seconds=60, finished_at=None, upcoming_matches=None):
    if not match:
        wake = _fixture_wake_seconds(upcoming_matches, now)
        return min(1800, wake) if wake is not None else 1800
    status = match['status']
    if status in ('live', 'halftime', 'extra_time', 'penalties', 'interrupted'):
        return max(300, min(600, live_seconds))
    if status == 'finished':
        return 60 if finished_at is not None and now.timestamp() - finished_at < 300 else 1800
    if status == 'scheduled':
        kickoff = kickoff_time(match)
        if kickoff:
            seconds = (kickoff - now).total_seconds()
            if seconds > 900:
                return max(15, min(1800, seconds - 900))
            if seconds > 0:
                return max(15, min(120, seconds))
        return 60
    wake = _fixture_wake_seconds(upcoming_matches, now)
    return min(1800, wake) if wake is not None else 1800


def match_visible(match, now, finished_at=None):
    if not match:
        return False
    # Only surface a fixture after play has begun. Scheduled and finished
    # fixtures remain useful to the scheduler, but do not occupy the desktop.
    return match['status'] in ('live', 'halftime', 'extra_time', 'penalties', 'interrupted')
