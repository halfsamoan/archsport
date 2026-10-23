# Development and verification

## Synthetic input

```sh
python3 -m archsport --demo --once
python3 -m archsport --replay data/replay-barcelona.json
```

Both paths use synthetic match data. A score-correction frame in the replay is not evidence of a separate VAR notification feature.

The browser prototype can be served separately:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory web
```

Web preferences are not synchronized with GNOME settings.

## Checks

```sh
python3 -m unittest discover -s tests -v
python3 tools/doctor.py --output local-diagnostics/doctor.json
glib-compile-schemas --strict --dry-run extension/schemas
```

The Python runtime uses only the standard library. Node-based JavaScript checks cannot prove GJS runtime compatibility.

## Install and update

```sh
python3 tools/install_extension.py
gnome-extensions enable archsport@local
gnome-extensions prefs archsport@local
```

Log out and back in after the first installation. To update:

```sh
git pull --ff-only
python3 tools/install_extension.py --upgrade
python3 tools/doctor.py
```

The installer may stage an update while the active Shell keeps the previously loaded code. Doctor distinguishes installed and running versions; use a new session to validate a staged release. Repeated development uses `tools/dev.py` and the isolated matci development loop.

## Provider configuration

| Provider | Role | Local credential path |
|---|---|---|
| football-data.org | Fixtures and recent results | `~/.config/archsport/football-data-token` |
| API-Football | Live match state and events | `~/.config/archsport/api-key` |

Configure each key through preferences. Credentials are stored separately from GSettings. State and request budgets live under `~/.local/state/archsport`; XDG overrides are supported. Do not run duplicate live workers against the same state.

Fixture caches and polling windows reduce requests, but provider quotas, season coverage, and delayed data still apply. Detailed statistics, lineups, and a domestic-cup fallback are not implemented.

## Restart behavior

A worker restart compares against persisted scores. With a stored baseline, only a recent latest goal within the configured recovery window is eligible for a new notification. Old goals and state-only transitions update the display without replaying every past alert. First-start observations establish a baseline.

## Target-device acceptance

Test enable/disable, real match events, suspend/resume, network recovery, display scaling, worker crashes, fullscreen behavior, and simultaneous matci placement on the target GNOME session. Synthetic replay and provider authentication are separate evidence from successful desktop notifications.

Historical records remain under `docs/` and `replica/`. Do not publish credentials, full desktop journals, or local databases.
