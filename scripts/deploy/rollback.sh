#!/usr/bin/env bash
# Roll back the parts of a release that went live. Usage: rollback.sh <staging|prod> [web] [worker]
# The database is never rolled back automatically: migrations are expand/contract, so the previous release runs on the
# current schema, and a bad migration is fixed forward (docs/18). With no part named, nothing is rolled back. Any part
# that cannot be rolled back fails the script, so the job shows it (docs/18: fail visibly).
set -euo pipefail
TARGET="${1:?staging | prod}"; shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API="${RENDER_API:-https://api.render.com/v1}"
PREV_FILE="${RENDER_PREV_FILE:-$ROOT/.render-prev}"
[ "$#" -gt 0 ] || { echo "rollback $TARGET: nothing went live, nothing to roll back"; exit 0; }
failed=0
for part in "$@"; do
  case "$part" in
    web)
      if [ "$TARGET" = prod ]; then
        # shellcheck source=scripts/deploy/vercel-cli.sh
        . "$ROOT/scripts/deploy/vercel-cli.sh"
        if ( cd "$ROOT/apps/web" && vercel_cli rollback --yes --token="$VERCEL_TOKEN" ); then echo "web rolled back"
        else echo "web rollback FAILED" >&2; failed=1; fi
      else
        # Staging is a Vercel preview (docs/01): `vercel rollback` acts on the production deployment, so it must not run
        # here. How a staging web rollback works waits on a founder decision (#19, questions 1 and 2).
        echo "web rollback for staging is not defined yet (#19): roll back by hand in Vercel" >&2; failed=1
      fi ;;
    worker)
      prev="$(cat "$PREV_FILE" 2>/dev/null || true)"
      if [ -z "$prev" ]; then
        echo "worker rollback FAILED: no deploy was live before this release ($PREV_FILE)" >&2; failed=1
      elif curl -fsS -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
          "$API/services/$RENDER_WORKER_SERVICE_ID/rollback" -d "{\"deployId\":\"$prev\"}" >/dev/null; then
        echo "worker rolled back to $prev"
      else echo "worker rollback FAILED" >&2; failed=1; fi ;;
    *) echo "unknown part '$part' (web | worker)" >&2; failed=1 ;;
  esac
done
exit "$failed"
