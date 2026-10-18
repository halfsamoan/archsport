"""Supported clubs and provider-neutral team names."""
import re
import unicodedata


WATCHED_TEAMS = ('Barcelona', 'Lazio', 'Como')
TEAM_MEDIA_IDS = {'barcelona': 529, 'lazio': 487, 'como': 895}

_ALIASES = {
    'barcelona': {'barcelona', 'fc barcelona', 'f c barcelona', 'barca'},
    'lazio': {'lazio', 'ss lazio', 's s lazio'},
    'como': {'como', 'como 1907', 'como 1907 fc', 'como calcio'},
}
_BY_ALIAS = {alias: team for team, aliases in _ALIASES.items() for alias in aliases}


def normalize_name(value):
    value = unicodedata.normalize('NFKD', str(value or '').casefold())
    value = ''.join(char for char in value if not unicodedata.combining(char))
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def canonical_team(value):
    return _BY_ALIAS.get(normalize_name(value))


def normalize_watch_list(values):
    if values is None:
        values = WATCHED_TEAMS
    if not values:
        raise ValueError('최소 한 팀은 선택해야 합니다.')
    teams = []
    for value in values:
        team = canonical_team(value)
        if team is None:
            raise ValueError('지원하지 않는 팀입니다. Barcelona, Lazio, Como 중에서 선택하세요.')
        if team not in teams:
            teams.append(team)
    return teams


def is_watched(name, watched):
    return canonical_team(name) in set(watched)


def team_label(key):
    return {'barcelona': 'Barcelona', 'lazio': 'Lazio', 'como': 'Como'}.get(key, str(key))
