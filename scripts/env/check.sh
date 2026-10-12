#!/usr/bin/env bash
# Lists required secret names present and missing for one environment. Never prints a value.
# Usage: check.sh <dev|staging|prod> [--all]
set -euo pipefail
ENVNAME="${1:?dev | staging | prod}"; shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
baseline="$(mktemp)"; trap 'rm -f "$baseline"' EXIT
compgen -e | sort > "$baseline"
# A name exported in this shell must not count as present in Infisical: unset every canonical and alias name first.
mapfile -t names < <(python3 - "$ROOT" <<'PY'
import re, sys
from pathlib import Path
root = Path(sys.argv[1])
names = set(re.findall(r"name: ([A-Z0-9_]+)", (root / "config/secrets.yaml").read_text()))
aliases = root / "config/secret-aliases.env"
if aliases.exists():
    names |= set(re.findall(r"^\s*[A-Z0-9_]+\s*=\s*([A-Z0-9_]+)", aliases.read_text(), re.M))
print("\n".join(sorted(names)))
PY
)
unset_args=(); for n in "${names[@]}"; do [ -n "$n" ] && unset_args+=(-u "$n"); done
env "${unset_args[@]}" "$ROOT/scripts/env/run.sh" "$ENVNAME" -- uv run --no-project --with pyyaml python \
  "$ROOT/scripts/env/check-secrets.py" --env "$ENVNAME" --baseline "$baseline" "$@"
