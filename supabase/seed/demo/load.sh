#!/usr/bin/env bash
# Load the Halden Pet Nutrition demo workspace (T-013) into a database. Idempotent: a second run does nothing.
#   supabase/seed/demo/load.sh                                       the local stack (as the Makefile's PSQL reaches it)
#   DEMO_SEED_TARGET=staging supabase/seed/demo/load.sh "$DB_URL"    any other database: the target must be named
# Local, CI and the staging demo workspace (the staging pipeline, T-010). Never production: it refuses a target named
# anything else, and a URL that mentions prod.
set -euo pipefail
seed="$(cd "$(dirname "$0")/../../tests/app/fixtures" && pwd)/demo_halden.psql"
if [ $# -gt 0 ]; then
  case "${DEMO_SEED_TARGET:-}" in
    local|ci|staging) ;;
    *) echo "load.sh: set DEMO_SEED_TARGET to local, ci or staging to load the demo into $1's host; never production" >&2
       exit 2 ;;
  esac
  if [[ "$1" == *prod* ]]; then
    echo "load.sh: refusing a URL that mentions prod: the demo seed never goes to production" >&2
    exit 2
  fi
  psql "$1" -v ON_ERROR_STOP=1 -q -f "$seed"
elif command -v psql >/dev/null; then
  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -q -f "$seed"
else
  docker exec -i supabase_db_nutrivo psql -v ON_ERROR_STOP=1 -q -U postgres < "$seed"
fi
