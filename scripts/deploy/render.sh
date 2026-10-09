#!/usr/bin/env bash
# Deploy the worker on Render at a given commit and wait until it is live. Usage: render.sh <service-id> <sha>
set -euo pipefail
SVC="${1:?service id}"; SHA="${2:?commit sha}"
api() { curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }
dep="$(api -X POST "https://api.render.com/v1/services/$SVC/deploys" -d "{\"commitId\":\"$SHA\",\"clearCache\":\"do_not_clear\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
echo "render deploy $dep started"
for _ in $(seq 1 90); do
  st="$(api "https://api.render.com/v1/services/$SVC/deploys/$dep" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')"
  case "$st" in live) echo "render deploy $dep live"; exit 0;; build_failed|update_failed|canceled|deactivated) echo "render deploy $dep $st" >&2; exit 1;; esac
  sleep 10
done
echo "render deploy $dep timed out" >&2; exit 1
