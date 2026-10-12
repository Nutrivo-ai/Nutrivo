# Contributing to Nutrivo

Two founders and their Claude Code sessions build Nutrivo together. People own decisions, accounts, regulatory
content acceptance and reviews; Claude Code does the engineering inside CLAUDE.md. The full protocol is
docs/15-build-protocol.md. This page is the short version, plus how the two of you divide the work.

## The loop
1. **Pick a task.** Every task in `plan/tasks.yaml` is an issue labelled `task`. `status:ready` means every dependency
   is closed; the `tracker` workflow recomputes it whenever a task issue closes. Claim one by assigning yourself, or
   let Claude Code do it: `make next LANE=<db|worker|web|infra|content|any>`. The assignment is the lock, so two people
   never take the same task. Issues labelled `gate:human` wait for a founder (START-HERE.md lists the gates).
2. **Branch** `t/T-123-short-name` from the latest `main`.
3. **Plan on the issue** before editing: files, migrations, tests by acceptance ID, risks.
4. **Build inside the task's lanes** (`plan/tasks.yaml` → `lanes`). Every acceptance ID of the task's workflows gets
   a test with the ID in its title, for example `[D04.must.1]`.
5. **Verify**: `make verify-task T=T-123`.
6. **Open the pull request** with the template filled in: `Task: T-123` and `Closes #<issue>`. Two other forms pass
   the protocol check: `Incident: #N` with `Closes #N` for a fix to an issue labelled `incident` or `nightly`, and
   `Task: none` for a founder's change to the target itself (spec, plan, decisions), which needs `human-approved`.
   Dependabot pull requests need neither, as long as they only touch dependency files.
7. **CI** must be green: `protocol`, `secrets-scan`, `database`, `worker`, `web`, `e2e`, `conformance`. Claude
   reviews against the spec automatically.
8. **Review**: the founder who did not push last approves (gate G5). Squash merge once the branch is up to date.
9. **After the merge** the issue closes, dependants turn `status:ready`, and every merge deploys to staging once
   staging is switched on (T-010).

## Working with Claude Code on the web
Open claude.ai/code, choose the Nutrivo repository and your Nutrivo environment (docs/22-github-and-team.md §5).
The session start hook provisions the tools and the local Supabase stack, and reports what is ready. Then, for
example:

- "Claim the next ready task in the web lane and implement it following CLAUDE.md and docs/15."
- "Continue T-104 on its branch; CI failed on the protocol check."
- "Review pull request #42 against its workflow specs." (Claude comments; a founder approves.)

Claude Code pushes task branches and opens pull requests. It never merges, approves, deploys, or edits the oracle
files (CLAUDE.md non-negotiables 11 and 12). Start a new session per task so the context stays focused.

## Splitting the work between two founders
- **Lanes keep you apart.** Take tasks in different lanes (`db`, `worker`, `web`, `infra`, `content`) at the same
  time. Only one migration pull request is open at a time: `make next` skips db tasks while one is open.
- **Each pull request is reviewed by the other founder.** If you pushed last, you cannot approve it.
- **Decisions are written down.** If something is not in spec/, docs/workflows/ or docs/02-decisions.md, ask on the
  issue with the `needs-human` label instead of deciding in a chat. A change to the target is its own pull request.

## Labels you will add yourselves
The two approval labels count only when a founder (a code owner on `main`, or the repository's admin) adds them by
hand; the protocol check ignores them when a bot, an app or anyone else does.

| Label | Means |
|---|---|
| `human-approved` | A founder accepts a change to protected files (spec, plan, CLAUDE.md, .claude, decisions, base migrations) |
| `scope-approved` | A founder accepts changes outside the task's lanes |
| `autopilot` | Claude Code may work on this ready issue on its own in GitHub Actions (from T-009/T-010) |
| `needs-human` | Claude stopped for a decision or approval |

## Rules that are not negotiable
CLAUDE.md lists twelve. The ones that bite people too:
- Never commit a secret or a `.env` file; run anything that needs secrets through `scripts/env/run.sh`.
- Never edit `supabase/tests/gates/**`, `worker/tests/gates/**`, `fixtures/golden/**`, `content/accepted/**` or
  `.milestone` in a task. A person changes an oracle file in its own pull request, with the reason.
- Never edit an applied migration; add a new one.
- Staging and production change only through GitHub Actions after review.

## Commands
`make help` lists everything. The ones you use daily: `make verify-fast` (what the Stop hook runs), `make gates`,
`make test`, `make next LANE=…`, `make verify-task T=…`, `make status`.
