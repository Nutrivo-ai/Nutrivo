#!/usr/bin/env bash
# CI: start the local Supabase stack, retrying once. A runner sometimes refuses the start with "failed to bind host
# port ... address already in use" (seen on 54322); a re-run passes. Before the retry, log what holds the stack's ports
# and stop anything half-started. Usage: supabase-start.sh db start | supabase-start.sh start -x studio,...
set -uo pipefail
cd "$(dirname "$0")/../.."
supabase "$@" && exit 0
echo "::warning::supabase $* failed; what holds the stack's ports (5432x), then one retry:"
sudo ss -ltnp 2>/dev/null | grep -E ':5432[0-9]\b' || echo "(nothing listening on 54320-54329)"
docker ps -a --format '{{.Names}} {{.Status}} {{.Ports}}' || true
supabase stop --no-backup || true
sleep 5
exec supabase "$@"
