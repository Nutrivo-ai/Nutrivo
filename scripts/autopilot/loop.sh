#!/usr/bin/env bash
# Local autopilot: claim a ready task, implement it with Claude Code headless, verify independently, open the PR,
# watch CI and feed failures back, up to MAX_FIX attempts. It never merges: review and merge stay with people.
# Usage: make autopilot LANE=web MAX_TASKS=3
set -uo pipefail
cd "$(dirname "$0")/../.."
LANE="${LANE:-any}"; MAX_TASKS="${MAX_TASKS:-1}"; MAX_FIX="${MAX_FIX:-3}"; MODEL="${MODEL:-claude-opus-5-5}"
PY="uv run --no-project --with pyyaml python"
run_claude() { claude -p "$1" --model "$MODEL" --permission-mode acceptEdits --max-turns 300; }
for _ in $(seq 1 "$MAX_TASKS"); do
  task="$($PY scripts/protocol/next-task.py --lane "$LANE" --claim --json)" || { echo "autopilot: nothing ready in lane $LANE"; exit 0; }
  id="$(echo "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
  issue="$(echo "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin)["issue"])')"
  branch="$(echo "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin)["branch"])')"
  echo "autopilot: $id (#$issue) on $branch"
  prompt="$(sed -e "s/{{TASK_ID}}/$id/g" -e "s/{{ISSUE}}/$issue/g" -e "s#{{BRANCH}}#$branch#g" scripts/autopilot/task-prompt.md)"
  run_claude "$prompt"
  if gh issue view "$issue" --json labels --jq '.labels[].name' | grep -qx needs-human; then
    echo "autopilot: $id needs a person (see the issue)"; continue
  fi
  for attempt in $(seq 1 "$MAX_FIX"); do
    if out="$(bash scripts/protocol/verify-task.sh "$id" 2>&1)"; then break; fi
    run_claude "make verify-task T=$id failed (attempt $attempt of $MAX_FIX). Fix the root cause without weakening, skipping or deleting tests and without touching protected files. Failure output (tail):
$(echo "$out" | tail -n 80)"
  done
  git push -u origin "$branch" >/dev/null 2>&1 || true
  pr="$(gh pr view "$branch" --json number --jq .number 2>/dev/null || true)"
  [ -z "$pr" ] && { echo "autopilot: no PR was opened for $id; asking for one"; run_claude "Open the pull request for $id now, following step 5 of your task prompt."; pr="$(gh pr view "$branch" --json number --jq .number 2>/dev/null || true)"; }
  [ -z "$pr" ] && { gh issue edit "$issue" --add-label needs-human; continue; }
  gh pr edit "$pr" --add-label autopilot >/dev/null
  for attempt in $(seq 1 "$MAX_FIX"); do
    if gh pr checks "$pr" --watch --fail-fast >/dev/null 2>&1; then echo "autopilot: $id PR #$pr is green, waiting for review"; break; fi
    run_id="$(gh run list --branch "$branch" --workflow ci --limit 1 --json databaseId --jq '.[0].databaseId')"
    log="$(gh run view "$run_id" --log-failed 2>/dev/null | tail -n 120)"
    run_claude "CI failed on PR #$pr for $id (attempt $attempt of $MAX_FIX). Fix the root cause, never by weakening tests or touching protected files, run make verify-fast, commit and push. Failing log tail:
$log"
    [ "$attempt" = "$MAX_FIX" ] && gh pr edit "$pr" --add-label needs-human
  done
done
