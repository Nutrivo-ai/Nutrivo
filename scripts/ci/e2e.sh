#!/usr/bin/env bash
# Full-stack end-to-end run on the local Supabase stack: worker + web + Mailpit + recorded model responses.
# Used by CI (make e2e-ci) and on laptops (make e2e). Expects the stack to be up (supabase start). Writes
# reports/e2e.xml (Playwright JUnit, read by the conformance report) and the worker's and web's logs beside it.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p reports
eval "$(supabase status -o env | sed -e 's/^/export /')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" DATABASE_URL="$DB_URL"
# Mail the stack sends lands in Mailpit; tests read it through Mailpit's API at MAILPIT_URL (older CLIs: INBUCKET_URL).
export MAILPIT_URL="${MAILPIT_URL:-${INBUCKET_URL:-http://127.0.0.1:54324}}"
export MODELS_MODE=replay EMAIL_MODE=mailpit NUTRIVO_ENV=ci

# A server already on port 3000 (a previous run's, or `pnpm dev`) would be tested instead of this build.
if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  echo "port 3000 is already serving: stop that server first (e.g. a leftover next-server from an earlier run)" >&2
  exit 1
fi

# The worker and the web server live only as long as this run: each starts in its own process group (setsid where
# there is one, as on Linux and CI), and the whole group is stopped on exit, next-server included, so a laptop keeps no
# stray processes and port 3000 is free for the next run.
pids=()
spawn() { if command -v setsid >/dev/null; then setsid "$@" & else "$@" & fi; pids+=($!); }
cleanup() {
  for p in "${pids[@]}"; do
    kill -TERM -- "-$p" 2>/dev/null || { pkill -TERM -P "$p" 2>/dev/null; kill -TERM "$p" 2>/dev/null; } || true
  done
}
trap cleanup EXIT

spawn bash -c 'cd worker && exec uv run nutrivo work' > reports/worker.log 2>&1
pnpm --dir apps/web build
spawn pnpm --dir apps/web start > reports/web.log 2>&1
npx --yes wait-on http://localhost:3000/api/health --timeout 120000
# A worker that died on start-up (bad configuration, a migration it needs) fails here with its log, not later as a
# confusing timeout in a test that waits for a job.
if ! kill -0 "${pids[0]}" 2>/dev/null; then
  echo "the worker exited before the tests ran; reports/worker.log:" >&2
  tail -n 50 reports/worker.log >&2
  exit 1
fi
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$PWD/reports/e2e.xml" pnpm --dir apps/web e2e --reporter=junit,list
