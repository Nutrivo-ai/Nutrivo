#!/usr/bin/env bash
# make verify-task T=T-123: the fast suite, then the task's acceptance coverage and checks.
set -euo pipefail
T="${1:?task id, e.g. T-123}"
cd "$(dirname "$0")/../.."
make verify-fast
uv run --no-project --with pyyaml python scripts/protocol/task-acceptance.py "$T"
