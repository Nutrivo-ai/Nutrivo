#!/usr/bin/env bash
# make verify-task T=T-123: the fast suite, then the task's acceptance coverage and checks, then the conformance
# ratchet: the PR carries the IDs that now pass in spec/conformance-baseline.json (always allowed; CONFORMANCE.md is
# generated and git-ignored).
set -euo pipefail
T="${1:?task id, e.g. T-123}"
cd "$(dirname "$0")/../.."
rm -rf reports            # only this run's results count, never a stale report from another branch
make verify-fast          # writes reports/worker.xml
uv run --no-project --with pyyaml python scripts/protocol/task-acceptance.py "$T"
make --no-print-directory db-tap conformance-update
