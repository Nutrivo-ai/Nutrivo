#!/usr/bin/env bash
# BOOTSTRAP step 7: configure the repository for the build protocol. Idempotent; exits non-zero if any step failed.
# Needs `gh` logged in as an admin of the repository. Everything here can also be done by hand in the GitHub UI:
# docs/22-github-and-team.md lists the same settings click by click. Usage: github-setup.sh owner/repo
set -uo pipefail
REPO="${1:?owner/repo}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fail=0
ok() { printf '  ✓ %s\n' "$1"; }; warn() { printf '  ! %s\n' "$1" >&2; }; bad() { printf '  ✗ %s\n' "$1" >&2; fail=1; }

echo "Repository"
if ! info="$(gh api "repos/$REPO" --jq '[.owner.type, .private, .default_branch] | @tsv' 2>&1)"; then
  bad "cannot read $REPO: $info"; exit 1
fi
IFS=$'\t' read -r owner_type private default_branch <<<"$info"
[ "$private" = "true" ] && ok "private" || bad "the repository is public: make it private first (Settings → General → Danger Zone)"
[ "$owner_type" = "Organization" ] && ok "owned by an organisation" \
  || warn "owned by a personal account: rulesets and environments on a private repo need a paid plan: GitHub Pro, or an organisation on Team (docs/22 §1)"
[ "$default_branch" = "main" ] && ok "default branch main" || bad "default branch is '$default_branch': set it to main"

echo "Labels and milestones"
bash "$ROOT/scripts/protocol/tracker-setup.sh" "$REPO" || fail=1

echo "Environments (deployment branches; required reviewers need GitHub Enterprise on private repos)"
env_policy() { # env, then policies as name:type
  local e="$1"; shift
  if ! err=$(gh api -X PUT "repos/$REPO/environments/$e" --input - 2>&1 >/dev/null \
       <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'); then
    bad "environment $e: $err"; return
  fi
  local have; have="$(gh api "repos/$REPO/environments/$e/deployment-branch-policies" --jq '.branch_policies[] | "\(.name):\(.type)"' 2>/dev/null)"
  for pol in "$@"; do
    echo "$have" | grep -qx "$pol" && continue
    gh api "repos/$REPO/environments/$e/deployment-branch-policies" -f name="${pol%%:*}" -f type="${pol##*:}" >/dev/null 2>&1 \
      || bad "environment $e: policy $pol"
  done
  ok "$e ($*)"
}
env_policy staging main:branch
env_policy production main:branch 'v*:tag'

echo "Rulesets (.github/rulesets/*.json)"
for f in "$ROOT"/.github/rulesets/*.json; do
  name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$f")"
  rid="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" 2>/dev/null | head -1)"
  if [ -n "$rid" ]; then method=PUT; path="repos/$REPO/rulesets/$rid"; else method=POST; path="repos/$REPO/rulesets"; fi
  if err=$(gh api -X "$method" "$path" --input "$f" 2>&1 >/dev/null); then ok "$name"
  else bad "ruleset $name: $err"; fi
done

echo "Actions variables"
pid="$(python3 -c "import json; print(json.load(open('$ROOT/.infisical.json'))['workspaceId'])" 2>/dev/null)"
if [ -n "$pid" ] && [ "${pid#<}" = "$pid" ]; then
  gh variable set INFISICAL_PROJECT_ID --repo "$REPO" --body "$pid" >/dev/null && ok "INFISICAL_PROJECT_ID" || bad "INFISICAL_PROJECT_ID"
else bad ".infisical.json is missing or still holds the placeholder (BOOTSTRAP step 3.1)"; fi
# Only for a project in Infisical's EU cloud (docs/22 §3): taken from this shell, as the Infisical CLI reads it.
if [ -n "${INFISICAL_DOMAIN:-}" ]; then
  gh variable set INFISICAL_DOMAIN --repo "$REPO" --body "$INFISICAL_DOMAIN" >/dev/null && ok "INFISICAL_DOMAIN" || bad "INFISICAL_DOMAIN"
fi

echo "Actions secrets: one Infisical machine identity per environment (values never printed)"
# Infisical dev holds the client id and secret of the identity that reads dev; staging and prod likewise. The dev one
# is a repository secret (CI, Claude workflows); the staging and prod ones are environment secrets, which only jobs
# on main or a v* tag can read, so a pull request branch can never fetch staging or production secrets.
for pair in dev: staging:staging prod:production; do
  src="${pair%%:*}"; scope="${pair##*:}"
  REPO="$REPO" SCOPE="$scope" "$ROOT/scripts/env/run.sh" "$src" -- bash -c '
    for n in INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET; do
      if [ -z "${!n:-}" ]; then echo "  ✗ $n is not in Infisical $NUTRIVO_ENV (docs/22 §3)" >&2; exit 1; fi
      printf %s "${!n}" | gh secret set "$n" --repo "$REPO" ${SCOPE:+--env "$SCOPE"} >/dev/null || exit 1
      echo "  ✓ $n (${SCOPE:-repository})"
    done' || fail=1
done

echo "Code owners"
errs="$(gh api "repos/$REPO/codeowners/errors" --jq '.errors | length' 2>/dev/null)"
[ "$errs" = "0" ] && ok "CODEOWNERS valid" || bad "CODEOWNERS has ${errs:-unknown} errors: gh api repos/$REPO/codeowners/errors"

echo "Still to do by hand (docs/22-github-and-team.md):"
[ -n "${INFISICAL_DOMAIN:-}" ] || echo "  · INFISICAL_DOMAIN variable, only for a project in Infisical's EU cloud (§3)"
echo "  · Claude GitHub App installed on the repository's owner with access to this repository (§1)"
echo "  · every founder can write to the repository and is listed in .github/CODEOWNERS (§1)"
echo "  · Sentry's GitHub integration, so production issues become GitHub issues"
exit $fail
