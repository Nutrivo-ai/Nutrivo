#!/usr/bin/env bash
# Labels and milestones the build protocol relies on. Idempotent; exits non-zero if anything could not be created.
# Runs from .github/workflows/tracker.yml (GITHUB_TOKEN) and from scripts/bootstrap/github-setup.sh.
# Usage: tracker-setup.sh owner/repo
set -uo pipefail
REPO="${1:?owner/repo}"
fail=0
ok() { printf '  ✓ %s\n' "$1"; }; bad() { printf '  ✗ %s\n' "$1" >&2; fail=1; }

echo "Labels"
while IFS='|' read -r name color desc; do
  [ -z "$name" ] && continue
  if err=$(gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force 2>&1 >/dev/null); then ok "$name"
  else bad "label $name: $err"; fi
done <<'LABELS'
task|0e8a16|A unit of work from plan/tasks.yaml
status:ready|0e8a16|All dependencies are closed
status:blocked|d4c5f9|Waiting on dependencies
gate:human|b60205|A founder must act inside this task
autopilot|5319e7|Claude Code may work on this autonomously
needs-human|b60205|Autopilot stopped: a decision or approval is needed
human-approved|0052cc|A founder approved a change to protected files
scope-approved|0052cc|A founder approved changes outside the task's lanes
incident|b60205|Staging or production incident
nightly|fbca04|Found by the nightly run
quarantine|fbca04|Flaky test in quarantine
bug:prod|b60205|Error seen in production
lane:db|1d76db|Database lane
lane:worker|1d76db|Worker lane
lane:web|1d76db|Web lane
lane:infra|1d76db|Infrastructure lane
lane:content|1d76db|Content lane
LABELS
for m in M0 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11; do
  gh label create "ms:$m" --repo "$REPO" --color c5def5 --force >/dev/null 2>&1 || bad "label ms:$m"
done

echo "Milestones"
if existing="$(gh api "repos/$REPO/milestones?state=all&per_page=100" --jq '.[].title' 2>&1)"; then
  for m in M0 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11; do
    if echo "$existing" | grep -qx "$m"; then ok "$m"
    elif err=$(gh api "repos/$REPO/milestones" -f title="$m" 2>&1 >/dev/null); then ok "$m (created)"
    else bad "milestone $m: $err"; fi
  done
else bad "cannot list milestones: $existing"; fi
exit $fail
