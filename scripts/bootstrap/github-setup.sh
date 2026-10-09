#!/usr/bin/env bash
# BOOTSTRAP step 7: configure the repository for the build protocol. Idempotent. Usage: github-setup.sh owner/repo
set -uo pipefail
REPO="${1:?owner/repo}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ok() { printf '  ✓ %s\n' "$1"; }; warn() { printf '  ! %s\n' "$1" >&2; }

echo "Labels"
while IFS='|' read -r name color desc; do
  [ -z "$name" ] && continue
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null && ok "$name" || warn "label $name"
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
for m in M0 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11; do gh label create "ms:$m" --repo "$REPO" --color c5def5 --force >/dev/null; done

echo "Milestones"
existing="$(gh api "repos/$REPO/milestones?state=all&per_page=100" --jq '.[].title' 2>/dev/null || true)"
for m in M0 M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11; do
  echo "$existing" | grep -qx "$m" || gh api "repos/$REPO/milestones" -f title="$m" >/dev/null; ok "$m"
done

echo "Environments"
for e in staging production; do gh api -X PUT "repos/$REPO/environments/$e" >/dev/null && ok "$e" || warn "environment $e"; done
warn "add required reviewers to the 'production' environment in Settings → Environments (gate G7)"

echo "Protection for main (ruleset)"
checks='[{"context":"protocol"},{"context":"secrets-scan"},{"context":"database"},{"context":"worker"},{"context":"web"},{"context":"e2e"},{"context":"conformance"}]'
base_rules='{"type":"deletion"},{"type":"non_fast_forward"},
 {"type":"pull_request","parameters":{"required_approving_review_count":1,"require_code_owner_review":true,"dismiss_stale_reviews_on_push":true,"require_last_push_approval":true,"required_review_thread_resolution":true}},
 {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":'"$checks"'}}'
mq='{"type":"merge_queue","parameters":{"check_response_timeout_minutes":60,"grouping_strategy":"ALLGREEN","max_entries_to_build":5,"max_entries_to_merge":5,"merge_method":"SQUASH","min_entries_to_merge":1,"min_entries_to_merge_wait_minutes":5}}'
body() { printf '{"name":"main","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[%s]}' "$1"; }
rid="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="main") | .id' 2>/dev/null | head -1)"
method=POST; path="repos/$REPO/rulesets"; [ -n "$rid" ] && { method=PUT; path="repos/$REPO/rulesets/$rid"; }
if body "$base_rules,$mq" | gh api -X "$method" "$path" --input - >/dev/null 2>&1; then ok "ruleset with merge queue"
elif body "$base_rules" | gh api -X "$method" "$path" --input - >/dev/null 2>&1; then ok "ruleset (no merge queue on this plan: branches must be up to date)"
else warn "rulesets unavailable on this plan: enable branch protection for main manually (docs/15)"; fi

echo "Actions secrets and variables (values never printed)"
"$ROOT/scripts/env/run.sh" dev -- bash -c '
for n in INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET; do
  if [ -n "${!n:-}" ]; then printf %s "${!n}" | gh secret set "$n" --repo "'"$REPO"'" >/dev/null && echo "  ✓ $n"
  else echo "  ! $n is not in Infisical dev: create the github-actions machine identity (universal auth) and store its client id and secret under these names" >&2; fi
done'
pid="$(python3 -c "import json; print(json.load(open('$ROOT/.infisical.json'))['workspaceId'])" 2>/dev/null)"
[ -n "$pid" ] && gh variable set INFISICAL_PROJECT_ID --repo "$REPO" --body "$pid" >/dev/null && ok "INFISICAL_PROJECT_ID"

echo "Still to do by hand (Claude Code asks the founder):"
echo "  · install the Claude GitHub App on the repository (in Claude Code: /install-github-app) so autopilot pull requests trigger CI"
echo "  · replace @NUTRIVO_OWNER in .github/CODEOWNERS with the founders' GitHub usernames"
echo "  · connect Sentry's GitHub integration so production issues become GitHub issues"
