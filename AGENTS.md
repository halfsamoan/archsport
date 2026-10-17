# Archsport contributor instructions

- Start with `docs/LINUX_HANDOFF.md`. It contains the user scope, current decisions, commands, and unverified work; no chat history is required.
- User target: ASUS Vivobook 15 Pro, Ubuntu GNOME, primarily FC Barcelona. Keep the notch below the top panel.
- Respond in Korean unless the user asks otherwise.
- Python core uses only the standard library. Tests: `python3 -m unittest discover -s tests -v`.
- Validate schemas with `glib-compile-schemas --strict --dry-run extension/schemas`. Node syntax checks cannot prove GJS/GNOME runtime compatibility.
- If RTK is installed, prefix terminal commands with `rtk` (use `rtk proxy` for unsupported commands). If unavailable on the new Linux machine, run the documented native commands.
- Real club crests are explicitly requested by the user. Do not replace them with invented marks. Keep asset provenance and never claim ownership of club trademarks.
- Never commit API keys, local databases, session files, environment dumps, or dconf exports. Use `local-diagnostics/` for device-only reports.
- Do not label synthetic replay as real matches or mark GNOME, suspend, scaling, or live API checks as passed without running them on the actual target.
- Keep Extension → subprocess for the first MVP. systemd user service/IPC is a future stabilization phase, not a current dependency.
