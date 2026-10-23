"""Reads config/secret-aliases.env: one CANONICAL=EXISTING per line, names only. Blank lines and # comments are
skipped; any other line stops with its line number (never its text, which could hold a pasted value), so a typo never
drops an alias silently. One parser for with-aliases.sh, check.sh, check-secrets.py and .github/actions/infisical.
Usage: aliases.py [file]   prints 'CANONICAL EXISTING' per alias."""
import re, sys
from pathlib import Path

NAME = re.compile(r"[A-Z_][A-Z0-9_]*")
DEFAULT = Path(__file__).resolve().parents[2] / "config/secret-aliases.env"


def load(path=DEFAULT):
    """(canonical, existing) pairs in file order; none when the file is absent. Raises ValueError on a bad line."""
    path = Path(path)
    if not path.exists():
        return []
    pairs = []
    # splitlines: CRLF and a last line without a newline read like any other line
    for n, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        canonical, sep, existing = (p.strip() for p in line.partition("="))
        if not (sep and NAME.fullmatch(canonical) and NAME.fullmatch(existing)):
            raise ValueError(f"{path.name} line {n}: expected CANONICAL=EXISTING, two upper-case names")
        pairs.append((canonical, existing))
    return pairs


if __name__ == "__main__":
    try:
        for canonical, existing in load(sys.argv[1] if len(sys.argv) > 1 else DEFAULT):
            print(canonical, existing)
    except ValueError as e:
        sys.exit(str(e))
