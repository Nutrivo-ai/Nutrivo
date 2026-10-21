# START HERE

You give this folder to Claude Code. Claude Code then:
- connects to your GitHub repository "Nutrivo" and wires itself to Infisical;
- proves every service works (Supabase, Stripe, Sentry, Langfuse, PostHog, AWS, Vercel, Render);
- configures GitHub and turns the 72 tasks in `plan/tasks.yaml` into issues;
- builds the product task by task until every acceptance test in `spec/` passes on staging.

You approve the gates listed below; everything else runs on its own. Nothing can promise that a build never goes
wrong. This system makes failures small, loud and quickly fixed, and keeps a person on every decision that matters.

## Before you start (10 minutes)
1. **Infisical token.** The shell that runs Claude Code has `INFISICAL_TOKEN`; in Claude Code on the web, the
   environment holds the `claude-dev` identity instead (docs/22 §5). If the project is in Infisical's EU cloud, also
   set `INFISICAL_DOMAIN=https://eu.infisical.com`.
2. **GitHub plan.** Enforced rulesets, code-owner review and environment secrets on the private `nutrivo-ai/Nutrivo`
   come with the `nutrivo-ai` organisation's paid GitHub Team plan (docs/22 §1). A merge queue needs Enterprise Cloud; without it the protocol
   falls back to "branch must be up to date".
3. **Tools.** On the web, the session start hook installs them. On a laptop: git, gh, Node 22+, pnpm, uv, Docker
   (running), Supabase CLI, Infisical CLI, Ghostscript and Poppler; `scripts/bootstrap/check-tools.sh` lists anything
   missing with the install command.
4. **Secrets.** Infisical holds the names in `config/secrets.yaml` for dev, staging and prod. Different names are
   fine: Claude Code maps them in `config/secret-aliases.env` and lists anything missing by name, never by value.

## Start
**On the web:** open claude.ai/code, choose `nutrivo-ai/Nutrivo` and your Nutrivo environment (docs/22 §5), and paste the
prompt below. **On a laptop:**
```bash
mkdir -p ~/code && cd ~/code && unzip nutrivo-handoff.zip && cd nutrivo
claude
```
Paste this into Claude Code:
```
Read START-HERE.md, BOOTSTRAP.md and CLAUDE.md. Execute BOOTSTRAP.md from step 1. Stop only at the gates it
names, and tell me exactly what you need from me at each one. Report after every step.
```

## Your gates (Claude Code stops and asks)
| Gate | When | What you do |
|---|---|---|
| G0 Tools | Bootstrap step 1 | Install what is missing (on the web the session start hook installs the tools; only the `claude-dev` variables in docs/22 §5 can be missing) |
| G1 Repository import | Bootstrap step 2, if the repository has code | Approve the import pull request (old code is archived on a branch and kept in `legacy/`, never deleted) |
| G1b GitHub settings | Bootstrap step 7, task T-004 | The settings in docs/22: collaborators, the two approval labels, rulesets, environments, Actions secrets; Claude Code cannot change them |
| G2 Secrets | Bootstrap steps 3–4 | Add or fix the named secrets in Infisical; run the `doctor` workflow for staging and prod |
| G2b Research conflicts | Task T-011 | Resolve the conflicts Claude Code records in docs/14 into docs/02-decisions.md |
| G3 Design files | Bootstrap step 6, only if the automatic download is refused | Download the Drive design folder into `design/`; on the web, upload it as a zip into the session |
| G4 Target freeze | Task T-012 | Approve `spec/screens.yaml`: every screen Claude Code found in your designs |
| G5 Merges | Every pull request | The `claude-review` workflow approves when its review ends in APPROVE-READY (D-23); you merge, and can still review, approve or dismiss its review |
| G6 Content | Weekly from milestone 2 | Accept rules in /admin (docs/12-content-ops.md) |
| G7 Deploy environments | T-010 and T-1101 | Approve the first staging and production deployments: the owner sets the switches in docs/22 §4 |
| G8 Stripe live | T-705 | Switch Stripe to live once test mode is proven |
| G9 Launch | T-1107 | Sign the launch review (docs/21-launch-criteria.md) |

## Several developers at once
Every developer, person or Claude Code session, runs `make next LANE=<lane>` to claim the next ready task. The claim
is a GitHub issue assignment, so two developers never take the same task. Lanes keep people out of each other's
folders, and database changes go one at a time. The GitHub autopilot (label `autopilot`) runs extra lanes in parallel.
See docs/15-build-protocol.md.

## Where to look
- **Progress:** the `conformance` summary of the latest CI run on main (`make conformance` writes the same
  CONFORMANCE.md locally), `spec/conformance-baseline.json`, and the GitHub issues per milestone.
- **Health:** Actions → `doctor` → Run workflow for staging and prod, `make doctor ENV=dev`, Sentry, Langfuse.
- **Done:** docs/21-launch-criteria.md.
