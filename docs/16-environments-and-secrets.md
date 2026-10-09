# 16 · Environments and secrets

| Environment | Database | Purpose | Infisical environment |
|---|---|---|---|
| local | Supabase in Docker | Development, CI, autopilot | dev (third-party test keys; Supabase keys come from `supabase status`) |
| staging | nutrivo-staging, Frankfurt | Every merge to main; demos | staging |
| production | nutrivo-prod, Frankfurt | Customers; releases by tag with approval | prod |

## Infisical
- **Structure.** One project with environments dev, staging and prod. `config/secrets.yaml` lists every
  required name: where it must exist, what uses it, and which doctor check proves it.
- **Machine identities.** Three:
  - Claude Code on your machine (`INFISICAL_TOKEN` in its environment);
  - GitHub Actions (`INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` repository secrets, `INFISICAL_PROJECT_ID`
    variable);
  - Infisical's secret syncs to Vercel and Render, so nothing is copied by hand.
- **Existing names.** Names you already use can map to the canonical ones in `config/secret-aliases.env`
  (names only, never values).

## Rules
- Run anything that needs secrets through `scripts/env/run.sh <env> -- <command>`. Secrets exist only in that
  process.
- Never print, echo, log or commit a secret, and never write .env files. Never run `infisical export`,
  `infisical secrets` or `printenv`; Claude Code is denied them.
- `make env-check ENV=<env>` lists names present and missing, never values.
- `make doctor ENV=<env>` proves each service works with the stored keys.
- Stripe keys are test mode in dev and staging, and live only in prod after gate G8.
- Rotate keys quarterly or on any suspicion, then run the doctor.
