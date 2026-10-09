#!/usr/bin/env bash
# Full-stack end-to-end run on the local Supabase stack: worker + web + Mailpit + recorded model responses.
# Used by CI (make e2e-ci) and on laptops (make e2e). T-009 owns and completes this file.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p reports
eval "$(supabase status -o env | sed -e 's/^/export /')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" DATABASE_URL="$DB_URL"
export MODELS_MODE=replay EMAIL_MODE=mailpit NUTRIVO_ENV=ci
( cd worker && uv run nutrivo work > ../reports/worker.log 2>&1 & )
pnpm --dir apps/web build
( pnpm --dir apps/web start > reports/web.log 2>&1 & )
npx --yes wait-on http://localhost:3000/api/health --timeout 120000
PLAYWRIGHT_JUNIT_OUTPUT_NAME="$PWD/reports/e2e.xml" pnpm --dir apps/web e2e --reporter=junit,list
