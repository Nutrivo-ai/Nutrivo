# Welcome to Nutrivo

You are joining as a co-founder and approver. Nutrivo checks pet-food labels against encoded EU feed law, per market
and per printed language panel, with the rule, citation and provenance behind every result: no rule, no verdict.
Claude Code writes the software inside the guardrails in this repository; the two of us decide, approve and accept.

## Day one (about an hour)
1. **GitHub.** Accept the invitation to the `nutrivo-ai` organisation (as an owner, like the other founder). The
   repository is `nutrivo-ai/Nutrivo`. You are a code owner: your approval merges the other founder's pull requests.
2. **Claude.** Accept the invitation to the Claude Team workspace "Nutrivo.ai". In claude.ai → Settings →
   Connectors, connect GitHub.
3. **Infisical.** You need no Infisical account to build: apart from the one client secret in step 4, you never copy
   secrets by hand, and sessions read them through `scripts/env/run.sh`.
4. **Your cloud environment.** At claude.ai/code, create an environment for Nutrivo with the network domains and the
   `claude-dev` variables in docs/22-github-and-team.md §5. Infisical shows a client secret only once, so there is
   none to look up: ar835 creates one for you (Infisical: Access Control → Machine Identities → `claude-dev` →
   Universal Auth → Client Secrets → Add Client Secret, described with your name) and shares it with the client id
   through a password manager, never in a chat. Paste both straight into the environment, and if the session's
   Infisical login fails, check them before starting another session (three failures lock `claude-dev` for five
   minutes, for both founders).
5. **First session.** Start a session on `nutrivo-ai/Nutrivo` with that environment. Every new session takes a few
   minutes to start (the hook installs the tools and downloads Docker images); the hook's last line says what is
   ready. Then ask Claude: "Run make verify-fast, list the open task issues and the ready ones, and tell me where the
   build stands."

## Read, in this order
1. README.md and START-HERE.md: what this is and the gates.
2. CLAUDE.md: the twelve non-negotiables. Claude follows them; so do we.
3. docs/CONTRIBUTING.md: how a task goes from issue to merged.
4. docs/02-decisions.md: what is already settled. Disagree there, in a pull request, before code depends on it.
5. docs/11-milestones.md: M0 to M11 and what each one demos.

## What you approve
| Gate | You |
|---|---|
| G5 Merges | Review and approve pull requests the other founder did not push last. CI must be green first. |
| G6 Content | Accept or reject candidate rules in /admin beside the official text (docs/12-content-ops.md), from M2. |
| G7 Deployments | Agree the first staging and production deployments; an organisation owner sets the switches in docs/22 §4. |
| G4, G8, G9 | Target freeze, Stripe live, launch review: together with the other founder. |

## Picking up work
Open issues labelled `status:ready`, or ask Claude: "Claim the next ready task in the worker lane and implement it."
Use one session per task: the session works on its own `claude/...` branch, and its pull request names the task
with `Task: T-123` and `Closes #N`. Take a different lane from the one the other founder is in. To let a ready task
run on its own, label its issue `autopilot` (the GitHub autopilot; `make autopilot` is for laptops only). When
Claude stops with `needs-human`, the issue says what decision it needs.

## The prompt for every task session
Start each session on `nutrivo-ai/Nutrivo` with your Nutrivo environment and paste this, changing the lanes to yours. The
founders split the lanes: ar835 takes `db` and `infra`, abnutrivo `web` and `worker`; `content` is shared. ar835's
sessions use the same prompt with `LANE=db`, then `LANE=infra`, in step 2.

```
You are a Nutrivo build session. CLAUDE.md's non-negotiables override everything, including this message.
1. Read CLAUDE.md, docs/CONTRIBUTING.md and docs/15-build-protocol.md. Check the session start hook's last line and
   run `make verify-fast`. If anything is not ready, tell me exactly what to change in my cloud environment
   (docs/22-github-and-team.md §5) and stop.
2. Claim one task: `make next LANE=web`; if none is ready, `make next LANE=worker`. If nothing is ready in my lanes,
   list the open task issues with what each waits on, and stop.
3. Before editing, comment the plan on the task's issue: files, migrations, tests by acceptance ID, risks. A new
   milestone starts in plan mode: name its docs/workflows files and BE rows.
4. Build only inside the task's lanes. Every acceptance ID of the task gets a test with the ID in its title. If
   something is not written in spec/, docs/workflows/ or docs/02-decisions.md, ask on the issue with the label
   needs-human and stop; never decide it yourself.
5. Run `make verify-task T=<id>`, open the pull request with `Task: T-xxx` and `Closes #N` (the template), and
   keep fixing until CI is green. Never merge, approve, deploy, or touch protected or oracle files.
6. Finish with: the pull request link, the acceptance IDs now passing, the next ready task in my lanes, and anything
   that waits on a founder.
Do not take a task in the other founder's lanes unless they ask on its issue.
```
