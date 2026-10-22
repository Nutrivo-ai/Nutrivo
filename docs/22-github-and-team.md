# 22 · GitHub, the team and Claude Code on the web

What a founder sets up once so that two founders and their Claude Code sessions build Nutrivo together under the
protocol in docs/15. Claude Code cannot change repository settings, invite people or create accounts; everything
below is a person's job. Steps are in order. The repository is `nutrivo-ai/Nutrivo`, private, in the `nutrivo-ai`
organisation on the GitHub Team plan. It moved there from `ar835/Nutrivo`; GitHub redirects the old address, but
every clone should run `git remote set-url origin https://github.com/nutrivo-ai/Nutrivo.git`, and no one may create a
repository named Nutrivo under `ar835` again (that ends the redirect).

## 1 · Organisation and people
1. **Plan.** GitHub Team enforces rulesets, code-owner review, environments and environment secrets on a private
   repository, and the rest of this page assumes it. It does not offer required reviewers or wait timers on
   environments of a private repository, or the Evaluate mode of rulesets (Enterprise); nothing here needs them.
2. **Both founders are organisation owners**: github.com/orgs/nutrivo-ai/people → Invite member → `abnutrivo` → Role in
   the organization: Owner → Send invitation (it expires after 7 days). Owners change settings, rulesets and apps and
   create `v*` release tags; GitHub recommends at least two. If `abnutrivo` accepted a repository invitation before the
   move, they are an outside collaborator instead: People → Outside collaborators → ⋯ → Invite to organization. Base
   permissions (organisation Settings → Member privileges) can stay at Read or No permission.
3. **Code owners**: `.github/CODEOWNERS` names `@ar835 @abnutrivo` on every line. The `main` ruleset no longer
   requires code-owner review (D-23), but the protocol check reads the `*` line to know whose `scope-approved` and
   `human-approved` labels count, so keep it. Each needs write access, which an owner has; GitHub flags an entry until
   then. A visible `founders` team with write access (`@nutrivo-ai/founders`) can replace the two names later.
4. **Claude GitHub App**: github.com/apps/claude/installations/new → `nutrivo-ai` → Only select repositories →
   `Nutrivo` (later: organisation Settings → GitHub Apps → Claude → Configure). Each founder connects GitHub in
   claude.ai (Settings → Connectors), and sessions choose `nutrivo-ai/Nutrivo`.
5. **Actions policy**: organisation Settings → Actions → General. Allow all actions and reusable workflows, or allow
   GitHub's own plus `astral-sh/setup-uv@*`, `pnpm/action-setup@*`, `supabase/setup-cli@*`,
   `anthropics/claude-code-action@*` and `Infisical/secrets-action@*`. "Require actions to be pinned to a full-length
   commit SHA" can be on: every action is pinned. Workflow permissions stay "Read repository contents and packages"
   (every workflow declares its own). "Allow GitHub Actions to create and approve pull requests" is **on**, at
   organisation and repository level (repository Settings → Actions → General), so `claude-review` can approve
   (D-23).
6. **Labels**: the `tracker` workflow creates every label, the two approval labels included (`scope-approved`,
   `human-approved`). Only a founder applies those two (docs/CONTRIBUTING.md).

## 2 · Rulesets (gate G5 enforced, not just agreed)
Imported once the set-up pull request was merged, so the rules did not block their own introduction. Repository →
Settings → Rulesets lists both, each with Enforcement status **Active**, and Settings → Branches holds no classic
branch protection rule (it would combine with them). To recreate one: New ruleset → **Import a ruleset**, once per
file:
- `.github/rulesets/main.json`: `main` only changes through a pull request with one approval (not from the last
  pusher; normally the `claude-review` workflow's, D-23, with code-owner review off), resolved threads, and green
  `protocol`, `secrets-scan`, `database`, `worker`, `web`, `e2e` and `conformance` on a branch that is up to date with
  `main`. Squash merges only. A later push dismisses the approval and the next review run decides again. A
  changes-requested review stays until the workflow approves a later head or a founder dismisses it.
- `.github/rulesets/release-tags.json`: only repository admins can create, move or delete `v*` tags, so a production
  release is always a founder's act. Repository admins are the organisation owners, the two founders.

No one bypasses the `main` ruleset. In a genuine emergency an organisation owner can set it to Disabled for that one
merge, then back to Active (Evaluate mode needs GitHub Enterprise, not Team); the audit log records it.

## 3 · Infisical identities and GitHub secrets
Machine identities live at organisation level in Infisical: Access Control → Machine Identities → Create, with the
organisation role **No Access** (their only access comes from a project). Infisical attaches Universal Auth to a new
identity. Open the identity → Authentication → Universal Auth: the **Client ID** has a copy icon and can be copied
again at any time; **Client Secrets → Add Client Secret** (description: who or what it is for; TTL 0 and Max Number of
Uses 0, so it neither expires nor runs out) shows the secret **once**, so paste it straight into its destination. To
cut one person or system off, revoke that client secret, not the identity.

- `claude-dev`: reads dev. One client secret per founder, so each can be revoked alone.
- `github-actions-dev`, `github-actions-staging`, `github-actions-prod`: read their one environment each; staging and
  prod are created at T-010. Infisical's plans count identities (people included), so rename unused identities for
  these rather than adding new ones.

**One Infisical project per environment.** The built-in project roles are Admin, Member, Viewer and No Access, and
Viewer reads every environment of its project. So each project holds exactly one environment, and each identity is a
**Viewer** of its own project only: project → Access Control → Machine Identities → Add Machine Identity to Project →
Assign Existing → the identity → Viewer.
- The dev project is the one in `.infisical.json`, with a single environment whose slug is `dev` (secrets in its root
  folder `/`). Delete its staging and production environments, after moving anything in them.
- At T-010, projects for staging (one environment, slug `staging`) and prod (slug `prod`). The GitHub environments
  `staging` and `production` each get their project's id as the environment variable `INFISICAL_PROJECT_ID`, which
  overrides the repository variable; every workflow that reads staging or prod runs in that environment.

Older projects may still show **Add Additional Privileges** on a project identity (role No Access, then a Secrets
policy allowing Describe Secret and Read Value where Environment equals its environment). Infisical is replacing it
with folder-based access and new projects lack it, so this page does not rely on it. Either way, the deny list in
`.claude/settings.json` is no substitute (docs/16), and the doctor's `infisical-scope` check fails if the identity a
session holds can read staging or prod in the dev project.

In GitHub, repository → Settings:
- **Secrets and variables → Actions → Repository secrets**: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` of
  `github-actions-dev`.
- **Secrets and variables → Actions → Variables**: only if the Infisical organisation is in Infisical's EU cloud (its
  address starts with `eu.infisical.com`), `INFISICAL_DOMAIN` = `https://eu.infisical.com`; then, last, because it
  switches the Claude workflows on, `INFISICAL_PROJECT_ID` = the id in `.infisical.json`.
- **Environments → New environment** `staging`: Deployment branches and tags → Selected → add branch `main`;
  Environment secrets → the two names, from `github-actions-staging`; Environment variables → `INFISICAL_PROJECT_ID`,
  the staging project's id (T-010).
- **Environments → New environment** `production`: Deployment branches and tags → Selected → branch `main` and tag
  `v*`; Environment secrets → the two names, from `github-actions-prod`; Environment variables →
  `INFISICAL_PROJECT_ID`, the prod project's id (T-1101).

A founder with a terminal can do section 2 and the dev part of section 3 in one go instead: `gh auth login`, then
`bash scripts/bootstrap/github-setup.sh nutrivo-ai/Nutrivo` (it reads the same ruleset files and copies the identities
from Infisical without printing them). It reads one Infisical project, so set the staging and production secrets and
variables by hand.

## 4 · Switches at the gates
Repository → Settings → Secrets and variables → Actions → Variables. Each workflow below does nothing until its
variable is `true`:

| Variable | Set at | Turns on |
|---|---|---|
| `STAGING_DEPLOY_ENABLED` | T-010, gate G7 (first staging deployment approved) | `deploy-staging` on every merge, the nightly staging run |
| `PRODUCTION_DEPLOY_ENABLED` | T-1101, gate G7 | `release-production` on a `v*` tag |
| `SYNTHETIC_ENABLED` | T-1102 | the 15-minute production smoke test |

## 5 · Claude Code on the web, per person
Each founder runs Claude Code at claude.ai/code in the Claude Team workspace "Nutrivo.ai", with GitHub connected
(a Claude organisation owner enables the GitHub connector), on the repository `nutrivo-ai/Nutrivo`.
Create one cloud environment (at claude.ai/code, the cloud icon above the message box → Cloud → Add cloud
environment; the settings icon beside an environment edits it) and use it for every Nutrivo session:

**Network access → Custom, "Also include default list of common package managers" ticked, and these allowed
domains**:

| Domain | Why |
|---|---|
| `app.infisical.com` (or `eu.infisical.com`, wherever the project lives) | secrets for `scripts/env/run.sh` |
| `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com` | local Supabase and the Infisical CLI images |
| `api.anthropic.com`, `bedrock-runtime.eu-central-1.amazonaws.com` | model calls in dev |
| `de.sentry.io`, `*.ingest.de.sentry.io`, `cloud.langfuse.com`, `eu.i.posthog.com` | observability round-trips (doctor) |
| `api.stripe.com` | Stripe test mode |
| `email.eu-central-1.amazonaws.com` | SES in dev |
| `eur-lex.europa.eu`, `publications.europa.eu` | official sources for the content track (K01) |
| `www.googleapis.com`, `drive.google.com`, `drive.usercontent.google.com` | the design set (BOOTSTRAP step 6); Drive serves downloads from the last |

Staging and production hosts (`api.supabase.com`, `api.vercel.com`, `api.render.com`) are deliberately absent:
deployments happen only in GitHub Actions (CLAUDE.md non-negotiable 11).

**Environment variables** (never in the repository):

| Name | Value |
|---|---|
| `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` | the `claude-dev` identity: its client id, and that person's own client secret |
| `INFISICAL_DOMAIN` | `https://eu.infisical.com`, only if the project is in Infisical's EU cloud |
| `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | recommended: a free Docker Hub account's read-only token avoids pull rate limits |

The repository's session start hook (`.claude/hooks/session-start.sh`) then installs Ghostscript, Poppler, the
pinned Supabase and Infisical CLIs and the worker dependencies, starts Docker and the local Supabase stack, and logs in
to Infisical. If that login fails, fix the values before starting another session: three failed logins within 30
seconds lock `claude-dev` for 5 minutes, for both founders. The hook runs at every session start and installs whatever is missing. Nothing it installs is cached for the
next session: each new session starts in a fresh container, so it takes several minutes to start while the tools
install and the Supabase images (several GB) download. A session that resumes in its own container skips what is
already there. The hook's last line says what is ready and what is not.

In a session, `gh issue` and `gh pr` are refused (the GitHub proxy blocks GraphQL): Claude reads and writes issues
and pull requests with its GitHub tools, and `make next` and `make status` use the REST API, which works. Each
session has its own `claude/...` branch; docs/CONTRIBUTING.md has the rest.

## 6 · Costs and limits worth knowing
- GitHub Team includes 3,000 Actions minutes a month for the organisation's private repositories. One pull request's CI is about 10
  job-minutes now and grows with the end-to-end suite; the autopilot and Claude review add their own. Watch
  organisation Settings → Billing and licensing from M1.
- Without the merge queue, `main` requires branches to be up to date: when two pull requests are ready together,
  merge one, then update the other (Update branch button) and let CI rerun.
