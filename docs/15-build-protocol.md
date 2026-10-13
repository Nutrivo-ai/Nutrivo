# 15 · Build protocol

How several developers, people and Claude Code sessions, build Nutrivo in parallel towards one fixed target,
with every change tested end to end and no drift.

## The target is written down, and nothing else gets built
| Artifact | What it fixes | Who changes it |
|---|---|---|
| docs/workflows/, spec/acceptance.yaml | The 71 workflows; one acceptance ID per main path, must-hold and failure case | Founders (CODEOWNERS), with a line in docs/02-decisions.md |
| spec/screens.yaml | Every screen in the designs: route, data, states, visual baseline | Generated in T-012, frozen at gate G4 |
| spec/nfr.yaml | Performance, availability, accessibility, security and cost budgets | Founders |
| docs/02-decisions.md | Product and architecture decisions | Founders |
| plan/tasks.yaml | The work: tasks with lanes, dependencies, workflows and checks | Founders; Claude Code proposes additions in a PR |

A change to the target is a pull request to these files, approved by a founder, before any code depends on it.
Code for something outside the target fails the protocol check.

## The unit of work: a task
Each task in plan/tasks.yaml becomes a GitHub issue (the `tracker` workflow; `make issues-sync` on a laptop).
A task names:
- its lanes (the folders it may change);
- its dependencies;
- its workflows (whose acceptance IDs it must make pass);
- any extra checks.

A task is ready when every dependency is closed. Tasks are sized to land as one pull request.

## Lanes keep developers apart
| Lane | Folders | Rule |
|---|---|---|
| db | supabase/migrations, supabase/tests/app, supabase/seed | One db task at a time (claimed or in an open PR); additive migrations only (expand, migrate, contract) |
| worker | worker/, supabase/functions/, fixtures/synth/ | Parallel |
| web | apps/web/, supabase/functions/ | Parallel; screens follow spec/screens.yaml |
| infra | .github/, scripts/, config/, render.yaml, Makefile | Parallel; deploy changes need a founder |
| content | content/candidates/, worker/prompts/, worker/evals/ | Parallel; acceptance is always a person |

Any task may touch docs/. Anything else outside the task's lanes fails the protocol check unless a founder adds the
`scope-approved` label.

## The loop (the same for a person and for Claude Code)
1. **Claim.** `make next LANE=web` takes the highest-priority ready task in the lane and assigns the issue. The
   assignment is the lock: it skips a task that is assigned, labelled `autopilot` or named by an open pull request. It uses the REST API, so it works in Claude Code on the web too, where Claude can also
   assign the issue with its GitHub tools. One task per session.
2. **Branch.** On a laptop `make next` starts `t/T-123-short-name` from the latest main. In Claude Code on the web the
   session's own `claude/...` branch is the task branch, and `make next` does not switch branches. Rebase at least
   daily.
3. **Plan.** Comment the plan on the issue before editing: files, migrations, tests by acceptance ID, risks.
4. **Build.** Stay inside the lanes. Every acceptance ID of the task's workflows gets a test whose title carries it,
   for example `[D04.must.1]`.
5. **Verify.** `make verify-task T=T-123` runs the fast suite and the task's checks, and confirms every acceptance
   ID has a test.
6. **Pull request.** Fill in the template: Task, Closes, acceptance IDs now passing, screens touched. `Task: T-123`
   and `Closes #N` name the task, whatever the branch is called; the pull request must close exactly its own open task
   issue. Claude Code cannot create or push tags (`git tag` is denied): to list them, `git ls-remote --tags origin`.
7. **CI.** Required checks: protocol, secrets-scan, database, worker, web, e2e, conformance. On an autopilot PR a
   failure triggers the fixer (up to three attempts) before a person is asked.
8. **Review.** The Claude reviewer comments against the spec; a founder approves.
9. **Merge.** Through the merge queue, or only when up to date with main, so the PR is tested on the latest main and
   main stays green.
10. **Staging.** Once `STAGING_DEPLOY_ENABLED` is set at T-010 (docs/22 §4), every merge deploys to staging, then runs
    smoke tests and the Sentry and Langfuse round-trip. A failure rolls back and opens an incident issue.
11. **Close.** The issue closes, dependants become ready, and `spec/conformance-baseline.json` keeps the IDs the task
    made pass, so the ratchet protects them from then on.

## Required checks and what each one stops
| Check | Stops |
|---|---|
| protocol | Work without a task; out-of-lane changes; edits to protected files; edited or out-of-order migrations; stale generated specs; an invalid plan |
| secrets-scan | Secrets committed to the repository |
| database | Any gate or app pgTAP failure |
| worker | Unit, handler and extraction-gate failures; lint |
| web | Lint, type, unit or build failure |
| e2e | Any end-to-end failure on the full local stack (database, worker, web, Mailpit, recorded model responses) |
| conformance | An acceptance ID that passed before and no longer does: the ratchet only moves forward |

## Drift, and what catches it
| Drift | Detector | Response |
|---|---|---|
| Building outside the spec | Protocol check (task and lanes); spec files are CODEOWNED | PR blocked |
| Regression | Conformance ratchet; nightly full suite on staging (from T-010) | Blocked, or an issue for the autopilot |
| Design | Each screen compared to its design baseline; no-dead-controls crawl | PR blocked |
| Contracts | Tests for the eight response shapes; generated database types compared | PR blocked |
| Schema between environments | Nightly `supabase db diff` against staging only (from T-010) | Issue; manual changes reverted by migration |
| Environment | Nightly doctor for staging only (from T-010); the `doctor` workflow for staging and prod on demand | Issue |
| Dependencies | Dependabot weekly; nightly audit | PRs and issues |
| Documentation | Workflow docs and acceptance.yaml regenerated and compared in CI | PR blocked |

## Self-healing development
- **CI failure on an autopilot PR:** the fixer reads the failing log and pushes a fix, up to three times, then labels
  the PR `needs-human`.
- **Staging deploy or smoke failure:** automatic rollback, plus an incident issue labelled `autopilot`.
- **Nightly failure:** an issue labelled `autopilot` with the failing test and its log.
- **Production error in Sentry:** a GitHub issue through Sentry's GitHub integration, triaged into a task.
- **Flaky test:** retried once, then quarantined with an issue. A quarantined acceptance test counts as failing.

## What the autopilot may and may not do
There are two. The GitHub autopilot (the `claude-autopilot` workflow, from T-009/T-010) takes a ready issue a founder
labels `autopilot`; this is the one to use from Claude Code on the web. `make autopilot` (scripts/autopilot/loop.sh)
runs tasks in sequence on a laptop only, because it needs `gh pr`, which the web refuses.

- **May:** claim ready tasks, write code and tests, open pull requests, fix its own CI failures, answer review
  comments.
- **May not:**
  - merge or approve;
  - change spec/ or protected files;
  - deploy to production;
  - accept regulatory content;
  - switch Stripe to live.

It stops and asks on the issue whenever a decision is not written down.

## Definition of done
- **Task:** merged with every check green; its acceptance IDs pass in CI and on staging; its workflow Status lines
  are updated.
- **Product:** docs/21-launch-criteria.md.
