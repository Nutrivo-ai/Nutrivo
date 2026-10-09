# Welcome to Nutrivo

You are joining as a co-founder and approver. Nutrivo checks pet-food labels against encoded EU feed law, per market
and per printed language panel, with the rule, citation and provenance behind every result: no rule, no verdict.
Claude Code writes the software inside the guardrails in this repository; the two of us decide, approve and accept.

## Day one (about an hour)
1. **GitHub.** Accept the invitation to the organisation and its `founders` team. You get Admin on `Nutrivo` and are
   a code owner: your approval merges pull requests.
2. **Claude.** Accept the invitation to the Claude Team workspace "Nutrivo.ai". In claude.ai → Settings →
   Connectors, connect GitHub.
3. **Infisical.** Accept the invitation to the Infisical project. You never copy secrets by hand; sessions read them
   through `scripts/env/run.sh`.
4. **Your cloud environment.** At claude.ai/code, create an environment for Nutrivo with the network domains and the
   `claude-dev` variables in docs/22-github-and-team.md §5. Get the `claude-dev` client id and secret from Infisical
   itself, not from a chat message.
5. **First session.** Start a session on the Nutrivo repository with that environment. The first start takes a few
   minutes (Docker images); the hook's last line says what is ready. Then ask Claude: "Run make verify-fast and
   make status, and tell me where the build stands."

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
| G7 Deployments | Approve the first staging and production deployments by setting the switches in docs/22 §4. |
| G4, G8, G9 | Target freeze, Stripe live, launch review: together with the other founder. |

## Picking up work
Open issues labelled `status:ready`, or ask Claude: "Claim the next ready task in the worker lane and implement it."
Take a different lane from the one the other founder is in. When Claude stops with `needs-human`, the issue says
what decision it needs.
