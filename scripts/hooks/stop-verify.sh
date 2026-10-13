#!/usr/bin/env bash
# Claude Code Stop hook. Exit code 2 blocks finishing and shows stderr to Claude, which keeps working.
# Claude Code ends the turn anyway after 8 consecutive blocks, so this cannot loop forever.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1

# Everything this branch changed since it left origin/main, plus uncommitted and untracked work. Never a local main:
# task branches start from origin/main and local main is often missing (cloud sessions, CI) or stale (laptops).
# --no-renames: a moved file also shows its old path. -z: no path is quoted (git quotes non-ASCII, '"', '\' and control
# characters, even with core.quotePath off), so each starts as it does on disk, to match below.
base=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || true)
g() { git "$@" 2>/dev/null; }
changed=$( { g diff -z --no-renames --name-only HEAD; g ls-files -z --others --exclude-standard
             [ -z "$base" ] || g diff -z --no-renames --name-only "$base" HEAD; } | tr '\0' '\n' | sort -u )
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

# In GitHub Actions only the jobs that start the local stack (autopilot build, claude-fix) set NUTRIVO_STOP_VERIFY=1;
# claude-review and @claude replies have none, so there the checks above are all that runs.
if [ "${GITHUB_ACTIONS:-}" = true ] && [ "${NUTRIVO_STOP_VERIFY:-}" != 1 ]; then exit 0; fi
if ! out=$(make verify-fast 2>&1); then
  echo "make verify-fast failed. Fix the failures before finishing (never by editing tests you do not own):" >&2
  echo "$out" | tail -n 60 >&2
  exit 2
fi
exit 0
