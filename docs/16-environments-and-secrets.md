# 16 · Environments and secrets

| Environment | Database | Purpose | Infisical environment |
|---|---|---|---|
| local | Supabase in Docker | Development, CI, autopilot | dev (third-party test keys; Supabase keys come from `supabase status`) |
| staging | nutrivo-staging, Frankfurt | Every merge to main from T-010; demos | staging |
| production | nutrivo-prod, Frankfurt | Customers; releases by the owner's `v*` tag (docs/22 §4) | prod |

## Infisical
- **Structure.** One Infisical project per environment, each holding a single environment (`dev`, `staging` or
  `prod`): Infisical's Viewer role reads every environment of its project, so this is how an identity reads exactly one
  (docs/22 §3). `.infisical.json` holds the dev project's id. `config/secrets.yaml` lists every required name: where
  it must exist, what uses it, and which doctor check proves it.
- **Machine identities** (universal auth), each a Viewer of its one project and nothing else (docs/22 §3):
  - `claude-dev`: reads dev. Every person's Claude Code on the web environment holds its client id and their own
    client secret as `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET`; the session start hook exchanges them for
    `INFISICAL_TOKEN`. On a laptop, `INFISICAL_TOKEN` in the shell does the same. It never reads staging or prod:
    `make doctor ENV=dev` fails its `infisical-scope` check if it can.
  - `github-actions-dev`, `github-actions-staging`, `github-actions-prod`: one per environment. The dev one is a
    repository secret (CI and the Claude workflows); the staging and prod ones are environment secrets on the GitHub
    environments `staging` and `production`, which only jobs on `main` or a `v*` tag can read. A pull request branch
    therefore never sees staging or production secrets, even if it edits a workflow. Each Infisical environment
    stores its own identity's client id and secret as `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET`, which is
    where `scripts/bootstrap/github-setup.sh` copies them from. `INFISICAL_PROJECT_ID` is a repository variable (the
    dev project); the GitHub environments `staging` and `production` override it with their own project's id.
  - Infisical's secret syncs to Vercel and Render, so nothing is copied by hand.
- **Switches.** Repository variables turn deployments on at their gates: `STAGING_DEPLOY_ENABLED` (T-010, G7),
  `PRODUCTION_DEPLOY_ENABLED` (T-1101, G7) and `SYNTHETIC_ENABLED` (T-1102). Until an organisation owner sets one to `true`, the
  matching workflow does nothing. docs/22-github-and-team.md has the click path.
- **Existing names.** Names you already use can map to the canonical ones in `config/secret-aliases.env`
  (names only, never values).

## Rules
- Run anything that needs secrets through `scripts/env/run.sh <env> -- <command>`. Secrets exist only in that
  process.
- Never print, echo, log or commit a secret, and never write .env files. Never run `infisical export`,
  `infisical secrets` or `printenv`; Claude Code is denied them.
- The deny list in `.claude/settings.json` is a convenience, not a boundary: a command can wrap a denied one and get
  past it. The boundaries are what each Infisical identity can read (docs/22 §3) and the `main` ruleset (docs/22 §2).
- `make env-check ENV=<env>` lists names present and missing, never values.
- `make doctor ENV=<env>` proves each service works with the stored keys.
- Stripe keys are test mode in dev and staging, and live only in prod after gate G8.
- Rotate keys quarterly or on any suspicion, then run the doctor.
