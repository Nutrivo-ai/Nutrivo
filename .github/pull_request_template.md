Task: T-
Closes #

## What changed

## Acceptance IDs now passing
<!-- e.g. A01.main, A01.must.1 — CI's conformance summary must agree -->

## Screens touched
<!-- spec/screens.yaml ids; CI attaches visual diffs -->

## Checklist
- [ ] Only files in the task's lanes changed (the protocol check enforces this)
- [ ] Every acceptance ID of the task has a test carrying it in its title
- [ ] `make verify-task T=<id>` is green locally
- [ ] Migrations are new files, additive, and work with the previous release (expand/contract)
- [ ] No secrets, no protected files, no skipped or weakened tests
- [ ] Workflow Status lines and docs updated
