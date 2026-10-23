# Contributing to Nutrivo

Two founders and their Claude Code sessions build Nutrivo together. People own decisions, accounts, regulatory
content acceptance and reviews; Claude Code does the engineering inside CLAUDE.md. The full protocol is
docs/15-build-protocol.md. This page is the short version, plus how the two of you divide the work.

## The loop
1. **Pick a task.** Every task in `plan/tasks.yaml` is an issue labelled `task`. `status:ready` means every dependency
   is closed; the `tracker` workflow recomputes it whenever a task issue closes. Claim one by assigning yourself, or
   let Claude Code do it: `make next LANE=<db|worker|web|infra|content|any>` (it uses the REST API, so it works on
   the web too), or Claude assigns the issue with its GitHub tools. The assignment is the lock, so two people never
   take the same task: `make next` skips a task that is assigned, labelled `autopilot` or named by an open pull
   request. Issues labelled `gate:human` wait for a founder (START-HERE.md lists the gates).
2. **Branch.** In Claude Code on the web the session works on its own `claude/...` branch: one task per session, and
   `make next` does not switch branches there. On a laptop `make next` starts `t/T-123-short-name` from the latest
   `main`.
3. **Plan on the issue** before editing: files, migrations, tests by acceptance ID, risks.
4. **Build inside the task's lanes** (`plan/tasks.yaml` → `lanes`). Every acceptance ID of the task's workflows gets
   a test with the ID in its title, for example `[D04.must.1]`.
5. **Verify**: `make verify-task T=T-123`.
6. **Open the pull request** with the template filled in: `Task: T-123` and `Closes #<issue>`. These two lines, not
   the branch name, tell the protocol check which task it is, and the pull request must close exactly its own open
   task issue. Two other forms pass the protocol check:
   `Incident: #N` with `Closes #N` for a fix to an issue labelled `incident` or `nightly`, and `Task: none` for a
   founder's change to the target itself (spec, plan, decisions), which needs `human-approved`.
   Dependabot pull requests need neither, as long as they only touch dependency files.
7. **CI** must be green: `protocol`, `secrets-scan`, `database`, `worker`, `web`, `e2e`, `conformance`. Claude
   reviews against the spec automatically.
8. **Review**: the `claude-review` workflow approves when its review ends in APPROVE-READY on an unchanged head, and
   requests changes on CHANGES-NEEDED (gate G5, D-23). No approval is required (D-24): your Claude Code session
   squash-merges once the branch is up to date, the checks are green and no review requests changes.
9. **After the merge** the issue closes, dependants turn `status:ready`, and every merge deploys to staging once
   staging is switched on (T-010).

## Working with Claude Code on the web
Open claude.ai/code, choose the Nutrivo repository and your Nutrivo environment (docs/22-github-and-team.md §5).
The session start hook provisions the tools and the local Supabase stack, and reports what is ready. Then, for
example:

- "Claim the next ready task in the web lane and implement it following CLAUDE.md and docs/15."
- In the session that opened the pull request: "CI failed on the protocol check; fix it."
- "Review pull request #42 against its workflow specs." (Claude reviews it and, if it did not author it, may approve.)
- "Merge everything that is green." (Claude updates branches, approves what it may and squash-merges, D-24.)

Claude Code pushes its session's branch and opens pull requests. It updates, approves and merges pull requests
(D-24; never its own approval on its own pull request or its own last push), and never deploys or edits the oracle
files (CLAUDE.md non-negotiables 11 and 12). Start a new session per task: the session's branch is the task's branch,
and the context stays focused.

On the web, `gh issue` and `gh pr` are refused (the GitHub proxy blocks GraphQL), so Claude reads, assigns, comments
on and closes issues with its GitHub tools; `make next` and `make status` use the REST API and work. `make autopilot`
(scripts/autopilot/loop.sh) and `make issues-sync` are for a laptop. On the web, run the `tracker` workflow (Actions →
tracker → Run workflow) instead of `make issues-sync`, and to let a ready task run on its own, label its issue
`autopilot`: the GitHub autopilot takes it (from T-009/T-010).

## Splitting the work between two founders
- **Lanes keep you apart.** Take tasks in different lanes (`db`, `worker`, `web`, `infra`, `content`) at the same
  time. Only one db task is in flight at a time: `make next` skips db tasks while another is claimed or has an open
  pull request. If you claim a db task by hand, first check that no other `lane:db` task is assigned.
- **The conformance baseline is a plain list.** When two task pull requests both add IDs to
  `spec/conformance-baseline.json`, the second one conflicts: keep both sides' IDs in one sorted list.
- **The `claude-review` workflow reviews each pull request** (D-23), and your Claude Code session merges it once it
  is green (D-24); no approval is required. A founder may still review, approve or dismiss a review. A Dependabot
  pull request gets no Claude review (no secrets); a session updates its branch and merges it when green.
- **Decisions are written down.** If something is not in spec/, docs/workflows/ or docs/02-decisions.md, ask on the
  issue with the `needs-human` label instead of deciding in a chat. A change to the target is its own pull request.

## Labels you will add yourselves
The two approval labels count only when a founder (a code owner on `main`, or the repository's admin) adds them, by
hand or through their own Claude Code session (D-24, for a change that founder asked for in that session); the
protocol check ignores them when a bot, another app or anyone else does. The `tracker` workflow creates all of
these once the set-up pull request is merged; before that, create the two approval labels by hand (docs/22 §1).

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
