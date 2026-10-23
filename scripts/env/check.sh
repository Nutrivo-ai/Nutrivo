#!/usr/bin/env bash
# Lists required secret names present and missing for one environment. Never prints a value.
# Usage: check.sh <dev|staging|prod> [--all]
set -euo pipefail
ENVNAME="${1:?dev | staging | prod}"; shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
baseline="$(mktemp)"; trap 'rm -f "$baseline"' EXIT
compgen -e | sort > "$baseline"
# A name exported in this shell must not count as present in Infisical: unset every canonical and alias name first.
# A malformed alias file stops here (set -e), with the line aliases.py names.
alias_pairs="$(python3 "$ROOT/scripts/env/aliases.py" "$ROOT/config/secret-aliases.env")"
mapfile -t names < <(python3 - "$ROOT" <<'PY'
import re, sys
from pathlib import Path
print("\n".join(sorted(set(re.findall(r"name: ([A-Z0-9_]+)", (Path(sys.argv[1]) / "config/secrets.yaml").read_text())))))
PY
)
while read -r canonical alias; do
  if [ -n "$canonical" ]; then names+=("$canonical" "$alias"); fi
done <<< "$alias_pairs"
unset_args=(); for n in "${names[@]}"; do [ -n "$n" ] && unset_args+=(-u "$n"); done
env "${unset_args[@]}" "$ROOT/scripts/env/run.sh" "$ENVNAME" -- uv run --no-project --with pyyaml python \
  "$ROOT/scripts/env/check-secrets.py" --env "$ENVNAME" --baseline "$baseline" "$@"
