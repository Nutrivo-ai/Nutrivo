#!/usr/bin/env bash
# The Vercel CLI, pinned: it runs beside staging and production secrets, so never @latest. Sourced by vercel.sh and
# rollback.sh; bump the version in a reviewed pull request.
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-64.1.0}"
vercel_cli() { npx --yes "vercel@${VERCEL_CLI_VERSION}" "$@"; }

# The Vercel project each target must deploy to (#19, docs/22): staging has its own project, so a staging deploy is a
# production deploy of nutrivo-staging and can be rolled back instantly. Before anything is built, deployed or rolled
# back, the project VERCEL_PROJECT_ID names is read back from Vercel and must be the target's, so a wrong ID in
# Infisical can never send a staging deploy (or rollback) to production, or the other way round.
vercel_expect_project() {
  local target="$1" want got
  case "$target" in
    staging) want="${STAGING_VERCEL_PROJECT:-nutrivo-staging}" ;;
    prod) want="${PROD_VERCEL_PROJECT:-nutrivo}" ;;
    *) echo "vercel: unknown target $target" >&2; return 2 ;;
  esac
  : "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is required}" "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
  got="$(curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" \
    "${VERCEL_API:-https://api.vercel.com}/v9/projects/${VERCEL_PROJECT_ID}${VERCEL_ORG_ID:+?teamId=$VERCEL_ORG_ID}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name",""))')" || got=""
  if [ "$got" != "$want" ]; then
    echo "vercel $target: VERCEL_PROJECT_ID names project '${got:-unreadable}', not '$want': refusing (docs/22)" >&2
    return 1
  fi
}
