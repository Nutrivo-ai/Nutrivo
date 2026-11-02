#!/usr/bin/env bash
# Deploy the worker on Render at a given commit and wait until it is live. Usage: render.sh <service-id> <sha>
# Before deploying it records the deploy that is live now in $RENDER_PREV_FILE (default .render-prev): once the new
# one is live the old one is deactivated, so rollback.sh could not find it afterwards. No live deploy: an empty file.
set -euo pipefail
SVC="${1:?service id}"; SHA="${2:?commit sha}"
API="${RENDER_API:-https://api.render.com/v1}"
PREV_FILE="${RENDER_PREV_FILE:-.render-prev}"
POLLS="${RENDER_POLLS:-90}"; EVERY="${RENDER_POLL_SECONDS:-10}"
# transient API errors are retried; a deploy that was started is cancelled on any failure below, so a worker this
# script reported as failed can never go live afterwards with nothing rolling it back (docs/18)
api() { curl -fsS --retry 3 --retry-all-errors --retry-delay 2 -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" "$@"; }
api "$API/services/$SVC/deploys?limit=20" \
  | python3 -c 'import json,sys; d=[x["deploy"] for x in json.load(sys.stdin) if x["deploy"]["status"]=="live"]; print(d[0]["id"] if d else "")' \
  > "$PREV_FILE"
echo "render: live before this deploy: $(cat "$PREV_FILE" | sed 's/^$/(none)/')"
dep="$(api -X POST "$API/services/$SVC/deploys" -d "{\"commitId\":\"$SHA\",\"clearCache\":\"do_not_clear\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
echo "render deploy $dep started"
cancel() { api -X POST "$API/services/$SVC/deploys/$dep/cancel" >/dev/null 2>&1 && echo "render deploy $dep cancelled" >&2 || echo "render deploy $dep could not be cancelled" >&2; }
trap 'cancel' ERR
for _ in $(seq 1 "$POLLS"); do
  st="$(api "$API/services/$SVC/deploys/$dep" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')"
  case "$st" in
    live) trap - ERR; echo "render deploy $dep live"; exit 0;;
    build_failed|update_failed|pre_deploy_failed|canceled|deactivated) trap - ERR; echo "render deploy $dep $st" >&2; exit 1;;
  esac
  sleep "$EVERY"
done
trap - ERR; echo "render deploy $dep timed out" >&2; cancel; exit 1
