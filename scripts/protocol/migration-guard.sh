#!/usr/bin/env bash
# CI: applied migrations are immutable, and new ones must sort after everything already on the base branch.
set -euo pipefail
base="${1:-}"
[ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] && { echo "migration guard: no base, skipped"; exit 0; }
changes="$(git diff --name-status "$base"...HEAD -- supabase/migrations/ || true)"
if echo "$changes" | grep -Eq '^(M|D|R)'; then
  echo "Applied migrations are immutable; add a new migration instead:" >&2; echo "$changes" | grep -E '^(M|D|R)' >&2; exit 1
fi
latest="$(git ls-tree --name-only "$base" supabase/migrations/ 2>/dev/null | sed 's#.*/##' | sort | tail -1)"
for f in $(echo "$changes" | awk '$1=="A"{print $2}'); do
  n="$(basename "$f")"
  if [ -n "$latest" ] && [[ ! "$n" > "$latest" ]]; then
    echo "Migration $n does not sort after $latest on the base branch: rebase and recreate it with 'supabase migration new'." >&2; exit 1
  fi
done
echo "migration guard: ok"
