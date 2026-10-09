#!/usr/bin/env bash
# Roll back web (Vercel) and worker (Render) to their previous successful deployments. The database is never rolled
# back automatically: migrations are expand/contract, so the previous release runs on the current schema.
set -uo pipefail
TARGET="${1:?staging | prod}"
cd "$(dirname "$0")/../.."
( cd apps/web && npx --yes vercel@latest rollback --yes --token="$VERCEL_TOKEN" ) && echo "web rolled back" || echo "web rollback FAILED" >&2
prev="$(curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" "https://api.render.com/v1/services/$RENDER_WORKER_SERVICE_ID/deploys?limit=10" \
  | python3 -c 'import json,sys; d=[x["deploy"] for x in json.load(sys.stdin) if x["deploy"]["status"]=="live"]; print(d[1]["id"] if len(d)>1 else "")')"
if [ -n "$prev" ]; then
  curl -fsS -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
    "https://api.render.com/v1/services/$RENDER_WORKER_SERVICE_ID/rollback" -d "{\"deployId\":\"$prev\"}" >/dev/null \
    && echo "worker rolled back to $prev" || echo "worker rollback FAILED" >&2
else echo "no previous worker deploy to roll back to" >&2; fi
