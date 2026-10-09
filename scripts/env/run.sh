#!/usr/bin/env bash
# Run a command with Infisical secrets for one environment. Nothing is written to disk or printed.
# Usage: scripts/env/run.sh <dev|staging|prod> -- <command...>
set -euo pipefail
ENVNAME="${1:?environment: dev | staging | prod}"; shift
[ "${1:-}" = "--" ] && shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PID="${INFISICAL_PROJECT_ID:-}"
if [ -z "$PID" ] && [ -f "$ROOT/.infisical.json" ]; then
  PID="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('workspaceId',''))" "$ROOT/.infisical.json")"
fi
args=(run --env="$ENVNAME" --silent)
[ -n "$PID" ] && [ "${PID#<}" = "$PID" ] && args+=(--projectId="$PID")
[ -n "${INFISICAL_TOKEN:-}" ] && args+=(--token="$INFISICAL_TOKEN")
export NUTRIVO_ENV="$ENVNAME"
exec infisical "${args[@]}" -- bash "$ROOT/scripts/env/with-aliases.sh" "$@"
