#!/usr/bin/env bash
# Claude Code Stop hook. Exit code 2 blocks finishing and shows stderr to Claude, which keeps working.
# Claude Code ends the turn anyway after 8 consecutive blocks, so this cannot loop forever.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1

# Everything this branch changed since it left origin/main, plus uncommitted and untracked work. Never a local main:
# task branches start from origin/main and local main is often missing (cloud sessions, CI) or stale (laptops).
base=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || true)
changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null
             [ -z "$base" ] || git diff --name-only "$base" HEAD 2>/dev/null; } | sort -u )
[ -z "$changed" ] && exit 0

# The oracle (CLAUDE.md non-negotiable 12): never changed in a Claude session.
oracle='^(supabase/tests/gates/|worker/tests/gates/|fixtures/golden/|content/accepted/|\.milestone$)'
if echo "$changed" | grep -Eq "$oracle"; then
  echo "Protected oracle files changed: $(echo "$changed" | grep -E "$oracle" | tr '\n' ' ')" >&2
  echo "Restore them (git checkout origin/main -- <path>), commit, and fix the implementation instead." >&2
  echo "If a gate or golden file is genuinely wrong, stop and explain why; a person changes it in its own PR." >&2
  exit 2
fi

# The rest of plan/tasks.yaml 'protected': founders do change these, so warn and carry on.
protected='^(spec/(acceptance|nfr|screens)\.yaml$|CLAUDE\.md$|\.claude/|plan/tasks\.yaml$|docs/02-decisions\.md$|supabase/migrations/2026100800000)'
if echo "$changed" | grep -Eq "$protected"; then
  echo "WARNING: protected files changed: $(echo "$changed" | grep -E "$protected" | tr '\n' ' ')" >&2
  echo "A founder must add the label 'human-approved' to the PR." >&2
  echo "If no person asked for this, restore them (git checkout origin/main -- <path>)." >&2
fi

if ! out=$(make verify-fast 2>&1); then
  echo "make verify-fast failed. Fix the failures before finishing (never by editing tests you do not own):" >&2
  echo "$out" | tail -n 60 >&2
  exit 2
fi
exit 0
