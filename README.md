# Archsport

A GNOME Shell match notch for Barcelona, Lazio, and Como fixtures, scores, and match events.

<img src=".github/assets/preview.png" alt="Archsport match notch with synthetic replay data" width="420">

Synthetic replay shown above. The notch hides when no match is active; fixtures and recent results remain available from the panel menu.

## Implementation

- **Provider integration:** combines football-data.org fixtures and results with API-Football live match state while keeping provider IDs separate.
- **Polling policy:** schedules requests around kickoffs, active matches, cache age, and local request budgets.
- **Event handling:** tracks score revisions and notification receipts to avoid replaying old events after worker restarts.
- **Desktop lifecycle:** connects GNOME settings and UI to a Python standard-library worker with bounded restart behavior and local SQLite state.

The extension shares placement rules with [matci](https://github.com/halfsamoan/matci); the applications remain independently installed.

[Provider integration](archsport/composite.py) · [Polling scheduler](archsport/scheduler.py) · [Desktop extension](extension/extension.js)

## Install

Requires GNOME Shell 50, Python 3, GLib schema tools, and GNOME extension preferences. From the repository root:

```sh
python3 tools/install_extension.py
```

Log out and back in after the first installation, then run:

```sh
gnome-extensions enable archsport@local
gnome-extensions prefs archsport@local
```

Set the API-Football and football-data.org keys separately in preferences. Numpad `Enter` toggles the notch.

## Run without API keys

```sh
python3 -m archsport --demo --once
```

The demo emits a synthetic match snapshot. It does not validate provider access or GNOME rendering.

## Validation status

Real GNOME match notifications, suspend/resume, scaling, and simultaneous display with matci require target-device testing. Provider latency and account limits apply; free-tier access does not guarantee real-time updates. Lineups and detailed match statistics are not implemented.

[Development and verification](CONTRIBUTING.md)

## License

[MIT](LICENSE). Club marks belong to their respective owners; see the [asset manifest](web/assets/logos/manifest.json).
