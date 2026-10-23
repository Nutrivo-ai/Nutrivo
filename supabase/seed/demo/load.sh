#!/usr/bin/env bash
# Load the Halden Pet Nutrition demo workspace (T-013) into a database. Idempotent: a second run does nothing.
# Usage: supabase/seed/demo/load.sh [DATABASE_URL]    (default: the local stack, as the Makefile's PSQL uses it)
# Local, CI and the staging demo workspace (the staging pipeline, T-010, passes its own URL). Never production.
set -euo pipefail
seed="$(cd "$(dirname "$0")/../../tests/app/fixtures" && pwd)/demo_halden.psql"
if [ $# -gt 0 ]; then
  psql "$1" -v ON_ERROR_STOP=1 -q -f "$seed"
elif command -v psql >/dev/null; then
  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -q -f "$seed"
else
  docker exec -i supabase_db_nutrivo psql -v ON_ERROR_STOP=1 -q -U postgres < "$seed"
fi
