#!/usr/bin/env bash
# Deploy the worker on Render at a given commit and wait until it is live. Usage: render.sh <service-id> <sha>
# Before deploying it records the deploy that is live now in $RENDER_PREV_FILE (default .render-prev): once the new
# one is live the old one is deactivated, so rollback.sh could not find it afterwards. No live deploy: an empty file.
set -euo pipefail
SVC="${1:?service id}"; SHA="${2:?commit sha}"
API="${RENDER_API:-https://api.render.com/v1}"
PREV_FILE="${RENDER_PREV_FILE:-.render-prev}"
POLLS="${RENDER_POLLS:-90}"; EVERY="${RENDER_POLL_SECONDS:-10}"
api() { curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }
api "$API/services/$SVC/deploys?limit=20" \
  | python3 -c 'import json,sys; d=[x["deploy"] for x in json.load(sys.stdin) if x["deploy"]["status"]=="live"]; print(d[0]["id"] if d else "")' \
  > "$PREV_FILE"
echo "render: live before this deploy: $(cat "$PREV_FILE" | sed 's/^$/(none)/')"
dep="$(api -X POST "$API/services/$SVC/deploys" -d "{\"commitId\":\"$SHA\",\"clearCache\":\"do_not_clear\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
echo "render deploy $dep started"
for _ in $(seq 1 "$POLLS"); do
  st="$(api "$API/services/$SVC/deploys/$dep" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')"
  case "$st" in live) echo "render deploy $dep live"; exit 0;; build_failed|update_failed|canceled|deactivated) echo "render deploy $dep $st" >&2; exit 1;; esac
  sleep "$EVERY"
done
echo "render deploy $dep timed out" >&2; exit 1
