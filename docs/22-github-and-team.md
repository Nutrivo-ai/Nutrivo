# 22 · GitHub, the team and Claude Code on the web

What a founder sets up once so that two founders and their Claude Code sessions build Nutrivo together under the
protocol in docs/15. Claude Code cannot change repository settings, invite people or create accounts; everything
below is a person's job. Steps are in order. `<org>` is the GitHub organisation's name.

## 1 · Organisation and repository
1. **Create the organisation** on the Team plan: github.com → your avatar → Your organizations → New organization →
   Team. Name it `nutrivo` if it is free (otherwise `nutrivo-ai` or similar).
   Team is the cheapest plan on which a private repository gets enforced rulesets, required code-owner reviews,
   environment secrets and deployment-branch rules. Required reviewers on environments and the merge queue need
   Enterprise; the protocol does not rely on either (see 4 and 6).
2. **Transfer the repository**: `ar835/Nutrivo` → Settings → General → Danger Zone → Transfer ownership → `<org>`.
   Issues, pull requests and settings move with it, and the old URL redirects.
3. **The founders team**: `<org>` → Teams → New team `founders`, add both founders. Then the repository → Settings →
   Collaborators and teams → Add teams → `founders` → role **Admin**.
4. **Code owners**: tell Claude Code the organisation name; it changes `.github/CODEOWNERS` to `@<org>/founders` in a
   pull request. Any one founder's approval then satisfies code-owner review.
5. **Claude GitHub App**: github.com/apps/claude → Configure → `<org>` → Only select repositories → `Nutrivo`.
   Each founder also connects GitHub in claude.ai (Settings → Connectors) so their sessions can push.

## 2 · Rulesets (gate G5 enforced, not just agreed)
Do this after the set-up pull request is merged, so the rules are not blocking their own introduction.
Repository → Settings → Rules → Rulesets → New ruleset → **Import a ruleset**, once per file:
- `.github/rulesets/main.json`: `main` only changes through a pull request with one founder approval (code owner,
  not the last pusher), resolved threads, and green `protocol`, `secrets-scan`, `database`, `worker`, `web`, `e2e`
  and `conformance` on a branch that is up to date with `main`. Squash merges only.
- `.github/rulesets/release-tags.json`: only repository admins (the founders) can create, move or delete `v*` tags,
  so a production release is always a founder's act.

No one bypasses the `main` ruleset. In a genuine emergency an owner can switch it to Evaluate for one merge and back;
the audit log records it.

## 3 · Infisical identities and GitHub secrets
In Infisical (project id is in `.infisical.json`), create machine identities with universal auth (docs/16):
- `claude-dev`: read dev.
- `github-actions-dev`, `github-actions-staging`, `github-actions-prod`: read their one environment each. Store each
  one's client id and secret in its own environment as `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`.

In GitHub, repository → Settings:
- **Secrets and variables → Actions → Repository secrets**: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` of
  `github-actions-dev`.
- **Secrets and variables → Actions → Variables**: `INFISICAL_PROJECT_ID` = the id in `.infisical.json`.
- **Environments → New environment** `staging`: Deployment branches and tags → Selected → add branch `main`;
  Environment secrets → the two names, from `github-actions-staging`.
- **Environments → New environment** `production`: Deployment branches and tags → Selected → branch `main` and tag
  `v*`; Environment secrets → the two names, from `github-actions-prod`.

A founder with a terminal can do sections 2 and 3 in one go instead: `gh auth login`, then
`bash scripts/bootstrap/github-setup.sh <org>/Nutrivo` (it reads the same ruleset files and copies the identities
from Infisical without printing them).

## 4 · Switches at the gates
Repository → Settings → Secrets and variables → Actions → Variables. Each workflow below does nothing until its
variable is `true`:

| Variable | Set at | Turns on |
|---|---|---|
| `STAGING_DEPLOY_ENABLED` | T-010, gate G7 (first staging deployment approved) | `deploy-staging` on every merge, the nightly staging run |
| `PRODUCTION_DEPLOY_ENABLED` | T-1101, gate G7 | `release-production` on a `v*` tag |
| `SYNTHETIC_ENABLED` | T-1102 | the 15-minute production smoke test |

## 5 · Claude Code on the web, per person
Each founder runs Claude Code at claude.ai/code in the Claude Team workspace "Nutrivo.ai", with GitHub connected.
Create one cloud environment (session title bar → environment → Edit) and use it for every Nutrivo session:

**Network access → Limited, Allow package managers ticked, and these allowed domains**:

| Domain | Why |
|---|---|
| `app.infisical.com` (or `eu.infisical.com`, wherever the project lives) | secrets for `scripts/env/run.sh` |
| `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com` | local Supabase and the Infisical CLI images |
| `api.anthropic.com`, `bedrock-runtime.eu-central-1.amazonaws.com` | model calls in dev |
| `de.sentry.io`, `*.ingest.de.sentry.io`, `cloud.langfuse.com`, `eu.i.posthog.com` | observability round-trips (doctor) |
| `api.stripe.com` | Stripe test mode |
| `email.eu-central-1.amazonaws.com` | SES in dev |
| `eur-lex.europa.eu`, `publications.europa.eu` | official sources for the content track (K01) |
| `www.googleapis.com`, `drive.google.com` | the design set (BOOTSTRAP step 6) |

Staging and production hosts (`api.supabase.com`, `api.vercel.com`, `api.render.com`) are deliberately absent:
deployments happen only in GitHub Actions (CLAUDE.md non-negotiable 11).

**Environment variables** (never in the repository):

| Name | Value |
|---|---|
| `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` | the `claude-dev` identity |
| `INFISICAL_API_URL` | `https://eu.infisical.com/api`, only if the project is in Infisical's EU region |
| `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | optional: a free Docker Hub account's read-only token avoids pull rate limits |

The repository's session start hook (`.claude/hooks/session-start.sh`) then installs Ghostscript, Poppler, the
pinned Supabase and Infisical CLIs and the worker dependencies, starts Docker and the local Supabase stack, and logs in
to Infisical. The first session in a new environment takes several minutes while images download; later sessions
reuse the cached container. The hook's last line says what is ready and what is not.

## 6 · Costs and limits worth knowing
- GitHub Team includes 3,000 Actions minutes a month for private repositories. One pull request's CI is about 10
  job-minutes now and grows with the end-to-end suite; the autopilot and Claude review add their own. Watch
  Settings → Billing → Actions from M1.
- Without the merge queue, `main` requires branches to be up to date: when two pull requests are ready together,
  merge one, then update the other (Update branch button) and let CI rerun.
