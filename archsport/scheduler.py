"""Pure scheduling policy; seconds, UTC aware datetimes, no network."""
from datetime import datetime


def kickoff_time(match):
    value = match.get('kickoff_utc') if match else None
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def poll_interval(match, now, live_seconds=60, finished_at=None):
    if not match:
        return 1800
    status = match['status']
    if status in ('live', 'halftime', 'extra_time', 'penalties', 'interrupted'):
        return max(60, min(300, live_seconds))
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
    return 1800


def match_visible(match, now, finished_at=None):
    if not match:
        return False
    # Only surface a fixture after play has begun. Scheduled and finished
    # fixtures remain useful to the scheduler, but do not occupy the desktop.
    return match['status'] in ('live', 'halftime', 'extra_time', 'penalties', 'interrupted')
