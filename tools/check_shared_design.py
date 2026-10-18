"""Fail when Archsport and matci's shared design definition drifts."""

import os
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "docs/design/design-tokens.json"
PEER = "matci" if ROOT.name == "archsport" else "archsport"
SIBLING = ROOT.parent / PEER / "docs/design/design-tokens.json"


def main() -> int:
    actual = LOCAL.read_bytes()
    if SIBLING.exists() and not os.environ.get("GITHUB_ACTIONS"):
        expected = SIBLING.read_bytes()
        source = str(SIBLING)
    else:
        source = f"https://raw.githubusercontent.com/halfsamoan/{PEER}/main/docs/design/design-tokens.json"
        with urlopen(source, timeout=15) as response:
            expected = response.read()
    if actual != expected:
        print(f"Shared design tokens differ from {source}")
        return 1
    print("Shared design tokens match byte-for-byte")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
