You are implementing task {{TASK_ID}} (GitHub issue #{{ISSUE}}) on branch {{BRANCH}} of the Nutrivo repository.
Follow CLAUDE.md and docs/15-build-protocol.md exactly.

1. Read the issue (`gh issue view {{ISSUE}}`), the task in plan/tasks.yaml, every workflow spec it names in
   docs/workflows/, their acceptance IDs in spec/acceptance.yaml, the screens in spec/screens.yaml and their design
   files in design/, and the docs the specs reference.
2. Post your plan as a comment on the issue before editing: files, migrations, tests by acceptance ID, risks.
3. Implement only inside the task's lanes. Every acceptance ID listed on the issue gets a test with the ID in its
   title (Playwright `[A01.main]`, pytest `test_A01_main_...`, pgTAP description `[A01.main] ...`).
4. Run `make verify-task T={{TASK_ID}}` until it is green. Never weaken, skip or delete a test; never edit protected
   files; never print secrets (use scripts/env/run.sh).
5. Commit as "{{TASK_ID}}: <summary>" (with spec/conformance-baseline.json, which verify-task updates), push the
   branch, and open a pull request with .github/pull_request_template.md filled in. Its body must contain the lines
   "Task: {{TASK_ID}}" and "Closes #{{ISSUE}}". Only in GitHub Actions (GITHUB_ACTIONS=true), then run
   `gh pr edit <pr-number> --add-label autopilot` so that claude-fix repairs CI failures; a local `make autopilot`
   run never adds that label, because its loop repairs CI itself.
6. If the task needs a decision that is not written down, or reaches a human gate: comment the question on the issue,
   add the label needs-human, and stop.
