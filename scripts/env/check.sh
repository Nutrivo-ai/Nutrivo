#!/usr/bin/env bash
# Lists required secret names present and missing for one environment. Never prints a value.
set -euo pipefail
ENVNAME="${1:?dev | staging | prod}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
baseline="$(mktemp)"; trap 'rm -f "$baseline"' EXIT
compgen -e | sort > "$baseline"
"$ROOT/scripts/env/run.sh" "$ENVNAME" -- uv run --no-project --with pyyaml python "$ROOT/scripts/env/check-secrets.py" \
  --env "$ENVNAME" --baseline "$baseline"
