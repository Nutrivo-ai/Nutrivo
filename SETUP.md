# Nutrivo · set-up and build walkthrough

> **Start with START-HERE.md.** Claude Code now performs steps 3–7 itself (BOOTSTRAP.md). This file stays the
> reference for the accounts behind config/secrets.yaml and for working without the autopilot.

This is for the people running the build. Claude Code writes the software inside the guardrails in this repository.
You decide, create accounts, accept regulatory content, review pull requests and run pilots.

| Who | Owns |
|---|---|
| Founders | Decisions, accounts and money, content acceptance (until a content owner is hired), reviews, pilots |
| Claude Code | Engineering, tests, content tooling, first-pass research and extraction |
| Feed-law expert (contract, 3–5 days) | Independent review of the accepted ruleset before the first paid contract |
| Swedish commercial lawyer | Terms, DPA, privacy and liability before the first sale |

| When | What |
|---|---|
| Day 1 | Steps 0–4 below: decisions, accounts, machine, repository, Claude Code |
| Weeks 1–16 | Milestones M0–M11 (docs/11-milestones.md), one branch each |
| Weekly from week 2 | Content track (Step 6), 3–5 hours of founder time |

---

## Step 0 · Lock the decisions (30 minutes)

Read `docs/02-decisions.md`. Every row has a default chosen from your design files. Change any row you disagree with
before milestone 0, because Claude Code treats that file as settled. The ones most worth a second look:
- **D-01 launch markets** (default: EU, with Sweden, Denmark, Finland and Germany first). Who are your first ten
  customers selling to? Change this if the answer is different.
- **D-02 hosting in Frankfurt.** Your DPA draft says Ireland; one of them has to change.
- **D-10 content.** Until a content owner is hired, a founder is the person who accepts rules.

## Step 1 · Create the accounts (half a day)

Create everything under Sunny Ventures AB. Store every key in Infisical, never in the repository or in chat.

| # | Service | Create | Settings that matter |
|---|---|---|---|
| 1 | GitHub | Organisation `nutrivo`, private repository `nutrivo` | Protect `main`: pull request required, CI must pass, one approval. Environments `staging` and `production` (production needs approval). |
| 2 | Supabase | Organisation; projects `nutrivo-staging` and `nutrivo-prod` | Region **Central EU (Frankfurt)**. Prod on Pro. API → Exposed schemas: add `app` and `ref`. Auth → email confirmations on, MFA (TOTP) on. Integrations → Queues on. Database → Extensions → pg_cron on. Save the project refs, keys and database passwords in Infisical. |
| 3 | AWS | Account; region eu-central-1 | Bedrock → request access to the Anthropic Claude models. SES → verify `mail.nutrivo.ai` and request production access. IAM user `nutrivo-worker` limited to Bedrock invoke and SES send. |
| 4 | Stripe | Account for Sunny Ventures AB (VAT SE559429715101) | Stay in test mode. Turn on Stripe Tax with your Swedish registration, and the customer portal. Do not create products by hand: milestone 7 does it from code. |
| 5 | Vercel | Team on Pro (Hobby is for non-commercial use) | Link the repository after milestone 0; root `apps/web`; function region Frankfurt. |
| 6 | Render | Workspace | The background worker is created in milestone 3, region Frankfurt. |
| 7 | Sentry, PostHog, Langfuse | One project each | Choose the EU data region in each (Langfuse EU is cloud.langfuse.com). |
| 8 | Infisical | Project `nutrivo`, environments dev / staging / prod | Connect to Vercel, Render and GitHub Actions later. `config/env.example` lists every variable. |
| 9 | DNS | `app.nutrivo.ai` → Vercel; `mail.nutrivo.ai` → SES | Add SPF, DKIM and DMARC for mail. |
| 10 | Claude | Your seat in the Claude Team workspace "Nutrivo.ai" | Used by Claude Code via `/login`. |

## Step 2 · Set up your machine (1 hour, macOS)

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git gh node pnpm uv supabase/tap/supabase ghostscript poppler
brew install infisical/get-cli/infisical
brew install --cask docker                      # then open Docker Desktop once
curl -fsSL https://claude.ai/install.sh | bash  # Claude Code, native installer
```

Check: `node -v` is 22 or newer (Claude Code and supabase-js need it), `supabase --version`, `uv --version`,
`docker info` and `claude --version` all answer. On Windows, do all of this inside WSL 2.

## Step 3 · Create the repository (30 minutes)

```bash
unzip nutrivo-handoff.zip && cd nutrivo
git init -b main && git add -A && git commit -m "Hand-off baseline, 8 Oct 2026"
gh repo create nutrivo/nutrivo --private --source . --push
```

Copy the design set: download the Google Drive design folder and unzip it into `design/`, keeping `build/`,
`product/`, `public/`, `_ds/`, `index.dc.html`, `support.js` and `doc-page.js`. Commit it as "Add design set".

Then prove the baseline works before any code is written:

```bash
infisical login && infisical init   # link this folder to the Infisical project
make bootstrap                      # worker dependencies
make fixtures                       # six synthetic labels with exact ground truth
make db-start                       # local Supabase in Docker (first run downloads images)
make gates                          # expect "All tests successful": 44 gate tests
```

If `make gates` is not green on a clean checkout, stop and fix that first. Everything later depends on it.

## Step 4 · Configure Claude Code (15 minutes)

```bash
claude            # in the repository root; trust the folder; /login with your Claude account
```

Inside Claude Code, check:
- `/permissions`. Gate tests, golden fixtures, accepted content and `.milestone` are write-protected; production
  commands (`supabase link`, `db push`, `functions deploy`) are denied.
- `/hooks`. The Stop hook runs `scripts/hooks/stop-verify.sh`. Claude cannot finish while tests fail or while a
  protected file is changed. Claude Code stops blocking after 8 tries in a row, so it never loops forever.
- `/agents`: rls-reviewer, spec-checker, content-verifier. `/skills`: implement-workflow, new-migration,
  new-rule-shape, content-extract.

Never give Claude Code production keys, and never link it to the production Supabase project.
Optional: Claude Code's GitHub integration can post a first review on every pull request.

## Step 5 · Run the milestones

Each milestone in `docs/11-milestones.md` has a prompt to paste, a definition of done and a review checklist.

```bash
git switch -c m1-app-shell
echo 1 > .milestone && git commit -am "Start milestone 1"   # people bump the milestone; Claude cannot
claude
```

Then:
1. Paste the milestone prompt. Claude Code plans first: read the plan, correct it, approve it.
2. Let it work. A milestone usually takes 2–6 sessions. Use `/clear` between sub-tasks to keep context sharp.
3. When it says it is done: run the milestone's review checklist yourself, and ask the rls-reviewer subagent about
   any change under `supabase/`.
4. Open the pull request, wait for CI, review, merge. From milestone 3 onwards, staging deploys on merge.
5. Click through the milestone's demo on staging before starting the next one.

Keep pull requests under about 1,500 changed lines; ask Claude Code to split anything larger.

To change a gate test or golden file (only if it is genuinely wrong): a person edits it on its own branch with
the reason in the commit message, merges that to `main`, then rebases the milestone branches.

## Step 6 · The content track (weekly, from week 2)

The product can only be as right as its ruleset. `docs/12-content-ops.md` has the method. The weekly rhythm:
- **Monday.** Claude Code runs the source watch and the extraction batch: two independent extractions per
  candidate rule from stored EUR-Lex text.
- **Tuesday–Wednesday.** You work the review queue in `/admin`: each candidate beside its verbatim official
  excerpt. Accept, reject or correct.
- **Thursday.** Claude Code drafts fixtures for what you accepted; you confirm them.
- **Friday.** Release a ruleset if every fixture passes. The public coverage page updates itself.

Before the first paid contract, contract an independent feed-law expert for 3–5 days to review the accepted
ruleset. Hire a content owner when revenue allows; the design files rank this hire first, for good reason.

## Step 7 · Staging and production

- **Staging.** Every merge to `main` runs CI, applies migrations to `nutrivo-staging` (`supabase db push` from
  GitHub Actions), deploys Edge Functions, redeploys the Render worker and the Vercel preview.
- **Production.** Tag `vX.Y.Z`. The same pipeline runs against `nutrivo-prod` after manual approval in the
  `production` environment. Turn on point-in-time recovery before the first customer uploads anything, and do one
  restore drill.

## Step 8 · Before the first pilot

- [ ] The public coverage page shows only released coverage: no invented counts, no named specialists.
- [ ] The marketing finding "1.9 mm, minimum 2.0 mm, 767/2009 Annex VI" is removed or correctly re-cited.
- [ ] Plan names and prices match the Priced Ladder and the three-label allowance everywhere.
- [ ] The DPA's sub-processor list matches what is deployed (docs/09-security.md).
- [ ] Terms, DPA and privacy policy reviewed by a Swedish commercial lawyer; liability cap checked with an insurer.
- [ ] The independent expert review of the ruleset is done; reports carry the boundary statement.
- [ ] PITR on, Sentry alerts on, uptime monitor on the verification endpoint.
- [ ] Each pilot's real artwork is added to `fixtures/golden/` with person-annotated expected results.
- [ ] A pentest is booked before the first paid contract.

## When something goes wrong

| Symptom | What to do |
|---|---|
| A gate test fails | Correct behaviour: the code is wrong, not the gate. Ask Claude Code to explain which non-negotiable it broke. |
| Claude Code asks to change a gate | Read its reason. If it is right, change the gate yourself in its own PR (Step 5). |
| The Stop hook keeps blocking | Run `make verify-fast` yourself and read the first failure. |
| `supabase start` fails | Docker Desktop is not running, or ports 54321–54324 are taken. |
| Claude Code drifts from the design | Point it at the exact file in `design/` and the spec-checker subagent. |
| Costs creep | Model calls are logged with cost in `app.model_calls`; check the weekly total in Langfuse. |
