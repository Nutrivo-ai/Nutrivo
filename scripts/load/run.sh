#!/usr/bin/env bash
# make load PROFILE=local|ci|staging (T-1105): every budget in spec/nfr.yaml, measured under load, then reported.
# - local, ci: against the local stack (supabase start), with the worker and the web's production build started here,
#   as scripts/ci/e2e.sh does. Models replay recorded responses, mail goes to Mailpit; nothing leaves the machine.
# - staging: against BASE_URL and the staging Supabase project, only inside GitHub Actions (nightly.yml, staging-load),
#   whose Infisical step has exported the staging variables. Never from a session or a laptop (CLAUDE.md 11).
# Writes reports/load.xml (Playwright JUnit), reports/load/<budget>.json and reports/LOAD.md; fails when a budget the
# profile enforces is exceeded or not measured, or when a budget in spec/nfr.yaml has no check.
set -euo pipefail
PROFILE="${1:-${PROFILE:-local}}"
cd "$(dirname "$0")/../.."
rm -rf reports/load reports/LOAD.md reports/load.xml
mkdir -p reports/load
export LOAD_PROFILE="$PROFILE"
PY=(uv run --no-project --with pyyaml python)

pids=()
spawn() { if command -v setsid >/dev/null; then setsid "$@" & else "$@" & fi; pids+=($!); }
cleanup() {
  for p in "${pids[@]}"; do
    kill -TERM -- "-$p" 2>/dev/null || { pkill -TERM -P "$p" 2>/dev/null; kill -TERM "$p" 2>/dev/null; } || true
  done
}
trap cleanup EXIT

case "$PROFILE" in
  staging)
    if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
      echo "the staging profile runs only in GitHub Actions (nightly.yml, staging-load); locally use PROFILE=local or ci" >&2
      exit 2
    fi
    export BASE_URL="${BASE_URL:-${APP_BASE_URL:?APP_BASE_URL (the staging web) is required}}"
    # The staging Infisical names (docs/16): the app's public URL and keys, and the service role for seeding.
    export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-${SUPABASE_URL:?SUPABASE_URL is required}}"
    export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}}"
    : "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
    ;;
  local|ci)
    supabase status >/dev/null 2>&1 || { echo "the local stack is not running: make db-start" >&2; exit 1; }
    [ -f fixtures/synth/out/.built ] || make fixtures
    eval "$(supabase status -o env | sed -e 's/^/export /')"
    export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
    export SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" DATABASE_URL="$DB_URL"
    export MAILPIT_URL="${MAILPIT_URL:-${INBUCKET_URL:-http://127.0.0.1:54324}}"
    export MODELS_MODE=replay EMAIL_MODE=mailpit NUTRIVO_ENV=ci
    export STRIPE_API_BASE="http://127.0.0.1:12111" STRIPE_SECRET_KEY="sk_test_fake"
    export BASE_URL="http://localhost:3000"
    if curl -s -o /dev/null --max-time 2 "$BASE_URL/"; then
      echo "port 3000 is already serving: stop that server first" >&2
      exit 1
    fi
    spawn bash -c 'cd worker && exec uv run nutrivo work' > reports/load/worker.log 2>&1
    [ "${LOAD_SKIP_BUILD:-}" = 1 ] || pnpm --dir apps/web build
    spawn pnpm --dir apps/web start > reports/load/web.log 2>&1
    npx --yes wait-on "$BASE_URL/api/health" --timeout 120000
    if ! kill -0 "${pids[0]}" 2>/dev/null; then
      echo "the worker exited before the load ran; reports/load/worker.log:" >&2
      tail -n 50 reports/load/worker.log >&2
      exit 1
    fi
    ;;
  *) echo "unknown profile $PROFILE: local, ci or staging (config/load/profiles.yaml)" >&2; exit 2 ;;
esac

status=0
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$PWD/reports/load.xml" pnpm --dir apps/web load --reporter=junit,list || status=$?
"${PY[@]}" scripts/load/budgets.py report --profile "$PROFILE" --out reports/LOAD.md ${GITHUB_STEP_SUMMARY:+--summary "$GITHUB_STEP_SUMMARY"} || status=1
exit "$status"
