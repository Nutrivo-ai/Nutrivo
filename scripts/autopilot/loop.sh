#!/usr/bin/env bash
# Local autopilot: claim a ready task, implement it with Claude Code headless, verify independently, open the PR,
# watch CI and feed failures back, up to MAX_FIX attempts. It never merges: review and merge stay with people.
# Its PRs never get the 'autopilot' label: that marks GitHub-autopilot PRs, which claude-fix repairs; this loop
# repairs its own.
# Usage: make autopilot LANE=web MAX_TASKS=3
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
LANE="${LANE:-any}"; MAX_TASKS="${MAX_TASKS:-1}"; MAX_FIX="${MAX_FIX:-3}"; MODEL="${MODEL:-claude-opus-5-5}"
PY="uv run --no-project --with pyyaml python"
run_claude() { claude -p "$1" --model "$MODEL" --permission-mode acceptEdits --max-turns 300; }
# A failed Claude run (no credentials, rate limit, max turns) stops the loop. Before a PR exists the task goes back
# to the pool; after, the PR waits for a person.
claude_or_stop() {
  run_claude "$1" && return
  local p; p="$(gh pr view "$branch" --json number --jq .number 2>/dev/null || true)"
  if [ -n "$p" ]; then gh pr edit "$p" --add-label needs-human >/dev/null; echo "autopilot: claude failed on $id; PR #$p needs a person" >&2
  else gh issue edit "$issue" --remove-assignee @me >/dev/null; echo "autopilot: claude failed on $id; #$issue unassigned" >&2; fi
  exit 1
}
clean() { git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; }
# Right after a push the PR still shows the previous commit, or no checks at all, and `gh pr checks` would report
# either as a failure. Wait until it shows checks for the local HEAD, up to 5 minutes.
await_checks() { local head; head="$(git rev-parse HEAD)"; for _ in $(seq 1 30); do
  [ "$(gh pr view "$pr" --json headRefOid --jq .headRefOid 2>/dev/null)" = "$head" ] &&
    [ -n "$(gh pr checks "$pr" --json name --jq '.[].name' 2>/dev/null)" ] && return; sleep 10; done; }
for _ in $(seq 1 "$MAX_TASKS"); do
  clean || { echo "autopilot: the working tree is not clean; commit or stash before claiming a task" >&2; exit 1; }
  task="$($PY scripts/protocol/next-task.py --lane "$LANE" --claim --json)"; rc=$?
  [ "$rc" = 3 ] && { echo "autopilot: nothing ready in lane $LANE"; exit 0; }
  [ "$rc" = 0 ] || { echo "autopilot: next-task.py failed (exit $rc)" >&2; exit "$rc"; }
  id="$(echo "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
  issue="$(echo "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin)["issue"])')"
  branch="$(echo "$task" | python3 -c 'import json,sys;print(json.load(sys.stdin)["branch"])')"
  echo "autopilot: $id (#$issue) on $branch"
  prompt="$(sed -e "s/{{TASK_ID}}/$id/g" -e "s/{{ISSUE}}/$issue/g" -e "s#{{BRANCH}}#$branch#g" scripts/autopilot/task-prompt.md)"
  claude_or_stop "$prompt"
  if gh issue view "$issue" --json labels --jq '.labels[].name' | grep -qx needs-human; then
    echo "autopilot: $id needs a person (see the issue)"; continue
  fi
  # Verify, then up to MAX_FIX fixes each verified again. Still red: a person takes over; nothing is pushed.
  verified=
  for attempt in $(seq 0 "$MAX_FIX"); do
    if out="$(bash scripts/protocol/verify-task.sh "$id" 2>&1)"; then verified=1; break; fi
    [ "$attempt" = "$MAX_FIX" ] && break
    claude_or_stop "make verify-task T=$id failed (fix $((attempt + 1)) of $MAX_FIX). Fix the root cause without weakening, skipping or deleting tests and without touching protected files. Failure output (tail):
$(echo "$out" | tail -n 80)"
  done
  if [ -z "$verified" ]; then
    echo "$out" | tail -n 40
    gh issue comment "$issue" --body "autopilot: \`make verify-task T=$id\` still fails after $MAX_FIX fixes. Nothing was pushed; the work is on the local branch $branch." >/dev/null
    gh issue edit "$issue" --add-label needs-human >/dev/null
    echo "autopilot: $id still fails verify-task; labelled needs-human, no PR"; continue
  fi
  # verify-task grows the conformance baseline (always allowed), which the PR carries. Anything else uncommitted
  # means the branch is not what was verified.
  git add -- spec/conformance-baseline.json && { git diff --cached --quiet || git commit -qm "$id: conformance baseline"; }
  if ! clean; then
    gh issue comment "$issue" --body "autopilot: \`make verify-task T=$id\` passed with uncommitted changes, so the branch is not what was verified. Nothing was pushed." >/dev/null
    gh issue edit "$issue" --add-label needs-human >/dev/null
    echo "autopilot: $id left uncommitted changes; labelled needs-human, no PR"; continue
  fi
  git push -u origin "$branch" >/dev/null 2>&1 || true
  pr="$(gh pr view "$branch" --json number --jq .number 2>/dev/null || true)"
  [ -z "$pr" ] && { echo "autopilot: no PR was opened for $id; asking for one"; claude_or_stop "Open the pull request for $id now, following step 5 of your task prompt."; pr="$(gh pr view "$branch" --json number --jq .number 2>/dev/null || true)"; }
  [ -z "$pr" ] && { gh issue edit "$issue" --add-label needs-human; continue; }
  # Watch CI, then up to MAX_FIX fixes each watched again.
  for attempt in $(seq 0 "$MAX_FIX"); do
    await_checks
    if gh pr checks "$pr" --watch --fail-fast >/dev/null 2>&1; then echo "autopilot: $id PR #$pr is green, waiting for review"; break; fi
    [ "$attempt" = "$MAX_FIX" ] && { gh pr edit "$pr" --add-label needs-human >/dev/null; echo "autopilot: $id PR #$pr still red; labelled needs-human"; break; }
    sha="$(gh pr view "$pr" --json headRefOid --jq .headRefOid)"
    run_id="$(gh run list --commit "$sha" --status failure --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
    log="$([ -n "$run_id" ] && gh run view "$run_id" --log-failed 2>/dev/null | tail -n 120)"
    claude_or_stop "CI failed on PR #$pr for $id (fix $((attempt + 1)) of $MAX_FIX). Fix the root cause, never by weakening tests or touching protected files, run make verify-fast, commit and push. Failing log tail:
$log"
  done
done
