# plan/

`tasks.yaml` is the work as a dependency graph (72 tasks, M0–M11). It is a protected file: founders change it, and
Claude Code proposes additions in a pull request.
- `make issues-sync` creates or updates one GitHub issue per task. Each issue gets lanes, milestone, dependencies,
  acceptance IDs and a ready or blocked label.
- `make next LANE=<lane>` claims the next ready task: lowest milestone first, then lowest id. Human-gated tasks are
  skipped unless INCLUDE_HUMAN=1. db-lane tasks are skipped while another migration PR is open.
- `scripts/protocol/validate-plan.py` (in CI) checks:
  - ids are unique and dependencies exist;
  - there are no cycles;
  - lanes are valid;
  - every BUILD workflow is covered by at least one task.
