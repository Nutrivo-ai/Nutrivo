#!/usr/bin/env bash
# Claude Code Stop hook. Exit code 2 blocks finishing and shows stderr to Claude, which keeps working.
# Claude Code ends the turn anyway after 8 consecutive blocks, so this cannot loop forever.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard;
             git diff --name-only main...HEAD 2>/dev/null; } | sort -u )
[ -z "$changed" ] && exit 0

protected='^(supabase/tests/gates/|worker/tests/gates/|fixtures/golden/|content/accepted/|\.milestone$)'
if echo "$changed" | grep -Eq "$protected"; then
  echo "Protected oracle files changed: $(echo "$changed" | grep -E "$protected" | tr '\n' ' ')" >&2
  echo "Revert them (git checkout main -- <path>) and fix the implementation instead." >&2
  echo "If a gate or golden file is genuinely wrong, stop and explain why; a person changes it in its own PR." >&2
  exit 2
fi

if ! out=$(make verify-fast 2>&1); then
  echo "make verify-fast failed. Fix the failures before finishing (never by editing tests you do not own):" >&2
  echo "$out" | tail -n 60 >&2
  exit 2
fi
exit 0
