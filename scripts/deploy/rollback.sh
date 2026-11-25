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
      # shellcheck source=scripts/deploy/vercel-cli.sh
      . "$ROOT/scripts/deploy/vercel-cli.sh"
      # Staging has its own Vercel project (#19), so `vercel rollback` acts on its production slot, never prod's: the
      # project is read back first and must be the target's.
      if vercel_expect_project "$TARGET" && ( cd "$ROOT" && vercel_cli rollback --yes --token="$VERCEL_TOKEN" ); then
        echo "web rolled back"
      else echo "web rollback FAILED" >&2; failed=1; fi ;;
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
