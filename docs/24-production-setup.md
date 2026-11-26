# 24 · Setting up production (gate G7, T-1101)

A founder's checklist, the production twin of docs/23 (staging). Do the steps in order; `release-production` does the
rest. Production is built from what staging already proved, with three differences: deploys come only from a `v*`
tag that a repository admin creates on a commit already on `main`; the database has point-in-time recovery (PITR) and
a restore drill before any customer data; and Stripe runs in live mode only after gate G8 (T-705).
Every name below is canonical (`config/secrets.yaml`). Doors stay closed until §7.

## 0. Where production stands (26 Nov 2026)
Done by a founder in the browser on 25–26 Nov 2026 (#365). No value is written here; every secret is in Infisical.

| Area | Done | Still open |
|---|---|---|
| Supabase | Organisation on **Pro**, spend cap on, no add-ons. `nutrivo-prod` created: ref `remlouoeznyoyfxxhbyx`, eu-central-1, Micro, database empty. Confirm email on, TOTP on, Queues (`pgmq`) on and **not** exposed through the Data API, `pg_cron` on. Site URL and redirect URLs: `https://nutrivo.ai` and `https://nutrivo.ai/**`. Auth email through SES SMTP (below). Access token "nutrivo-prod deploy": this project only, organisation settings none | PITR (§6, stage 2). Exposed schemas `app` and `ref`, and the "Before User Created" hook: both need the schema the first release creates (§5). Google and Microsoft providers (§4) |
| Old project | "Nutrivo.ai", ref `vjoklurplnegrdfofqvu`, **eu-west-1 (Ireland)**, created 11 Aug 2026, no tables: **paused**. It is not production and never was: Ireland is outside D-02 | Delete it once nobody needs its few Auth accounts |
| Infisical | Project **Nutrivo prod** (ID `d2231d37-57ca-4660-8790-f87307a199bf`), one environment, slug `prod`, on app.infisical.com. 35 names: every staging name except `STAGING_DOMAIN` (staging only) and the three `STRIPE_*`. Secret sync to Render `nutrivo-worker-prod` (auto-sync on, Infisical wins on import, auto-redeploy off) | `NUTRIVO_ENV` must read `prod` (§3). `STRIPE_*` test keys (§3). Vercel sync: at the first release. Identity `github-actions-prod` (§2). Region: US or EU, a founder decides before the identity exists |
| AWS | IAM user `nutrivo-prod-worker` (no console; the staging worker's policy: Bedrock invoke on EU profiles only, SES send in eu-central-1 only), one access key in Infisical. SES eu-central-1 has production access; `nutrivo.ai` and `noreply@nutrivo.ai` verified | — |
| Render | Background worker `nutrivo-worker-prod` (Docker, `worker/Dockerfile`, Frankfurt, auto-deploy off), 0.5 CPU / 512 MB, 1 instance | Plan: `render.yaml` says `standard` with 2 instances, and the deployed worker runs ClamAV (§1). Its first deploy predates its variables; the first release redeploys it |
| Vercel | Nothing changed. Project `nutrivo` serves `nutrivo.ai` (primary); `www.nutrivo.ai` redirects to it | — |
| Observability | Staging and production **share** the Sentry projects (`nutrivo-web`, `nutrivo-worker`, functions DSN), the PostHog project and the Langfuse project, told apart by environment (D-33) | PostHog events carry no environment yet (#365) |

**Supabase Auth email (SMTP).** Both Supabase projects send Auth email (confirmations, sign-in links, password resets)
through SES in eu-central-1, not Supabase's built-in mailer, which sends 2 an hour:
- `nutrivo-prod`: sender `Nutrivo <noreply@nutrivo.ai>`, IAM user `nutrivo-prod-supabase-smtp`.
- `nutrivo-staging`: sender `Nutrivo Staging <noreply@nutrivo.ai>`, IAM user `nutrivo-staging-supabase-smtp`.
- Both use host `email-smtp.eu-central-1.amazonaws.com`, port 587, and the IAM group `AWSSESSendingGroupDoNotRename` (`ses:SendRawEmail`). The SMTP credentials live only in each Supabase project's Auth settings.
- The Auth email rate limit is 30 an hour on both projects, not `supabase/config.toml`'s local 2.

## 1. Accounts that must work first
- **Supabase:** the production project `nutrivo-prod` (ref `remlouoeznyoyfxxhbyx`, eu-central-1) in the organisation
  on Pro, because PITR needs a paid plan (docs/runbooks/restore-drill.md). Not `vjoklurplnegrdfofqvu`: that is the
  paused Ireland project (§0).
- **AWS:** the production IAM identity has Bedrock invoke on the EU inference profiles, `bedrock:GetInferenceProfile`
  and `bedrock:GetAccountDataRetention` (read only), and SES send. Bedrock data retention is **none** in every EU
  Region (D-11). SES has **production access** for the sending domain; in the sandbox it only sends to verified
  addresses, so invitations and reports would not reach customers.
- **Vercel:** production deploys to the existing project `nutrivo` (team Nutrivoai). Staging has its own project,
  `nutrivo-staging` (#19, docs/22 §4), so nothing on `nutrivo` is shared with staging any more.
- **Render:** a worker service `nutrivo-worker-prod` in Frankfurt (`render.yaml`). The deployed worker scans uploads
  with ClamAV (`SCAN_MODE=clamav`, docs/16), so give it the blueprint's plan (`standard`, 2 GB) rather than 512 MB.

## 2. Create the resources
| Service | Create | Notes |
|---|---|---|
| Supabase | Settings on `nutrivo-prod` (§4) | Keep the database password: it is `SUPABASE_DB_PASSWORD` |
| Infisical | Project `nutrivo-prod`, one environment, slug `prod` | One project per environment (docs/22 §3) |
| Infisical | Machine identity `github-actions-prod` (organisation role No Access), added to that project as **Viewer** | Universal Auth: copy the client ID and a client secret (shown once) |
| Infisical | Secret syncs: Vercel project **`nutrivo`**, environment **Production**; Render service `nutrivo-worker-prod` | The build pulls Production (`scripts/deploy/vercel.sh prod`); no copying by hand |
| Sentry, Langfuse, PostHog | The EU projects, or production copies | EU-hosted, or the doctor fails |
| Render | `nutrivo-worker-prod`, Frankfurt | Its ID is `RENDER_WORKER_SERVICE_ID` |
| Vercel | Nothing new: project `nutrivo` | Its ID is `VERCEL_PROJECT_ID`. The deploy refuses unless that ID names `nutrivo` (scripts/deploy/vercel-cli.sh) |

## 3. Secrets into Infisical (project `nutrivo-prod`, environment `prod`, folder `/`)
The same names and sources as staging (docs/23 §3), from the production accounts, with these differences:

| Name | Production |
|---|---|
| `SUPABASE_*`, `DATABASE_URL` | From `nutrivo-prod` (Project Settings → API; Connect → session pooler) |
| `VERCEL_PROJECT_ID` | The **`nutrivo`** project's ID, never `nutrivo-staging`'s |
| `RENDER_WORKER_SERVICE_ID` | `nutrivo-worker-prod`'s `srv-…` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | **Test mode until G8**, and needed before the first release: `scripts/deploy/function-secrets.sh` refuses a release without a `whsec_…` secret. The webhook is a test-mode endpoint for `https://remlouoeznyoyfxxhbyx.supabase.co/functions/v1/stripe-webhook` with the events docs/23 §3 lists. At G8 (T-705) a founder swaps in the live keys and the live webhook's signing secret, with Smart Retries off and the events docs/08 lists |
| `SENTRY_DSN_FUNCTIONS` | The functions' DSN. Staging and production share it (D-33); the functions tag events with `NUTRIVO_ENV` |
| `APP_BASE_URL` | The production web URL, https: `https://nutrivo.ai` (no trailing slash) |
| `NUTRIVO_ENV` | `prod`, exactly. The worker refuses any value but `local`, `dev`, `ci`, `staging` or `prod`, and the Render sync puts Infisical's value above `render.yaml`'s |
| `SYNTHETIC_USER_EMAIL`, `SYNTHETIC_USER_PASSWORD` | A synthetic account on a business domain (D-27) |
| `SYNTHETIC_VERIFY_REF` | Optional: a report of the synthetic workspace, once one exists (scripts/synthetic/check.py) |
| `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` | The `github-actions-prod` identity's |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_*` | **Leave unset.** The worker refuses to start in prod when they are set (D-11) |

Then `make env-check ENV=prod ALL=1` is the T-1101 check. Only a GitHub Actions run can read prod (CLAUDE.md 11), so
run it through the `doctor` workflow (§5).

## 4. Supabase production settings
- **Auth → Providers:** Google and Microsoft (organizations tenant) with the production OAuth apps; email confirmation
  on. **Auth → Hooks:** "Before User Created" (D-27, T-109).
- **Auth → URL configuration:** the site URL and redirect URLs are the production web URL only.
- **Auth → Rate limits:** the values in `supabase/config.toml` (`[auth.rate_limit]`, T-1103), except email: 30 an
  hour through SES SMTP (§0), where `config.toml`'s 2 is for the local mailer.
- **Auth → SMTP:** SES in eu-central-1 (§0).
- **API:** exposed schemas `app`, `ref` and `public` only; "Automatically expose new tables" **off**; no
  `pgmq_public` (D-26). The doctor's `supabase-grants` check proves it.
- **Add-ons → Point in time recovery:** on, with a retention (docs/runbooks/restore-drill.md, "Before the first drill").

## 5. GitHub
1. Settings → Environments → **production**: the secrets `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`
   (`github-actions-prod`) and the variable `INFISICAL_PROJECT_ID` (the prod project's ID). Tags `v*` only are
   created by repository admins (`.github/rulesets/release-tags.json`).
2. Actions → **doctor** → Run workflow with `prod` and `all` ticked, `strict` not ticked. It runs read-only for prod.
   Every name must be present; only the checks that need a first deploy may skip. `pitr` fails until PITR is on
   (§6), which is expected before stage 2.
3. Settings → Variables → **`PRODUCTION_DEPLOY_ENABLED`** = `true`.
4. Create the first tag on a commit already on `main` (for example `v0.1.0`): GitHub → Releases → Draft a new release
   → new tag on `main`. `release-production` pushes the migrations, sets the functions' secrets, deploys the
   functions, the worker and the web (to `nutrivo`, as production, then promotes), runs `make smoke ENV=prod`, then
   the doctor. A failure rolls back what went live (never the database) and opens a "Production release … rolled
   back" issue (docs/runbooks/rollback.md).
   - The release's doctor runs **with** its write checks (Sentry, Langfuse, PostHog and Bedrock round-trips), so a
     release proves production data reaches them (docs/21, item 5). #10 (ENV-13) asked for `--readonly` here; a founder
     decides which holds (raised on #79).
5. After the first release, in `nutrivo-prod`: add `app` and `ref` to the exposed schemas (keeping `public`, with
   "Automatically expose new tables" off), and enable Authentication → Hooks → "Before User Created" →
   `private.before_user_created_hook` (D-27). Both need the schema the release created.
6. Run **doctor** again with `prod`, `all` and `strict`. Link that run on T-1101's issue.

## 6. Before any customer data (G7)
1. **Restore drill:** the first one, by docs/runbooks/restore-drill.md. Its Sentry cron monitor `restore-drill-prod`
   then expects one a month.
2. **Synthetic monitoring:** Settings → Variables → `SYNTHETIC_ENABLED` = `true`. `synthetic.yml` checks production
   every 15 minutes inside the Sentry monitor `synthetic-smoke-prod` (T-1102). docs/21 item 4 asks for 7 green days.
3. **Alerts reach named people:** each Sentry monitor and alert rule notifies a named founder (docs/17).

## 7. Opening the doors (at launch, after G6, G8 and G9)
These are deliberately not done at G7; production stays closed to strangers until the founders launch.
- Vercel → `nutrivo` → Firewall: remove the rules "pre-launch: pilot form" and "pre-launch: app closed".
- Vercel → `nutrivo` → Domains: add `app.nutrivo.ai` back, if the app is served there.
- Infisical prod: `NEXT_PUBLIC_SIGNUPS_OPEN` = `true`, so the site's buttons read "Check a label free" instead of
  "Join the pilot" (apps/web/src/lib/public/links.ts); then a release, because it is read at build time.
- Invite the pilot list (the "Nutrivo pilot list" sheet).
