# 23 · Setting up staging (gate G7, T-010)

A founder's checklist. Do the steps in order; the staging pipeline (docs/22 §4) does the rest. On 10 Nov 2026, the dev
doctor was green, and Infisical answered 404 for both the staging and prod projects, so staging starts from nothing.
Every name below is canonical (`config/secrets.yaml`). If you already use another name, map it in
`config/secret-aliases.env` instead of renaming it.

## 1. Accounts that must work first
- **Vercel:** preview deploys reported "Account is blocked" on 3 Nov. Clear that first (billing or account status).
- **AWS:** add `bedrock:GetInferenceProfile` and `bedrock:GetAccountDataRetention` (both read only) to the IAM
  policy of the identity whose keys go into staging. The doctor's `bedrock-retention` check needs them. Then set
  Bedrock data retention to **none** in each EU Region (D-11).

## 2. Create the resources
| Service | Create | Notes |
|---|---|---|
| Supabase | Project `nutrivo-staging`, region eu-central-1 (Frankfurt) | Keep the database password; it is `SUPABASE_DB_PASSWORD` |
| Infisical | Project `nutrivo-staging`, with one environment, slug `staging` | docs/22 §3: one project per environment |
| Infisical | Machine identity `github-actions-staging` (organisation role No Access), added to that project as **Viewer** | Universal Auth: copy the client ID, and add a client secret (shown once) |
| SES (eu-central-1) | Verify the sending domain; request production access | Until then, SES sends only to verified addresses |
| Sentry, Langfuse, PostHog | Use the existing EU projects, or a staging copy | All must be EU-hosted, or the strict doctor fails |
| Render | A worker service in Frankfurt (the pipeline deploys to it) | Its service ID becomes `RENDER_WORKER_SERVICE_ID` |
| Vercel | The `nutrivo` project (team Nutrivoai) already exists | Its ID becomes `VERCEL_PROJECT_ID` |

## 3. Secrets into Infisical (project `nutrivo-staging`, environment `staging`, folder `/`)
| Name | Where the value comes from |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API keys → anon (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → service_role (secret) |
| `SUPABASE_PROJECT_REF` | The project's ID, the subdomain in the project URL |
| `SUPABASE_DB_PASSWORD` | Set when you created the project (reset it under Database settings if lost) |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → new token |
| `DATABASE_URL` | Supabase → Connect → connection string (session pooler) with the password filled in |
| `AWS_REGION` | `eu-central-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM user or role keys with Bedrock invoke, the two read permissions in §1, and SES send |
| `BEDROCK_MODEL_JUDGEMENT`, `BEDROCK_MODEL_TRIAGE`, `BEDROCK_MODEL_EXTRACTION` | The same EU inference-profile IDs as dev (the dev doctor proves they answer). Switch to the `eu.anthropic.claude-*-5-5` profiles once AWS grants access (T-014) |
| `SES_FROM_ADDRESS` | An address on the verified domain, for example `noreply@<domain>` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Stripe **test mode** → Developers → API keys (live keys only in prod, at G8) |
| `STRIPE_WEBHOOK_SECRET` | Stripe test mode → Webhooks → add an endpoint for the staging `stripe-webhook` function → signing secret. Send the payment, subscription and invoice events docs/08 lists, plus `invoice.voided` and `invoice.marked_uncollectible` (T-704). Turn Smart Retries off under Billing settings |
| `SENTRY_DSN_WEB`, `SENTRY_DSN_WORKER` | Sentry → each project → Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB`, `SENTRY_PROJECT_WORKER` | Sentry → Settings → Auth Tokens; the organisation and project slugs |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Langfuse → project → Settings → API keys; base URL `https://cloud.langfuse.com` (EU) |
| `POSTHOG_KEY`, `POSTHOG_HOST` | PostHog EU → Project settings → project API key; host `https://eu.i.posthog.com` |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Vercel → Account → Tokens; the team ID and the project ID (Project → Settings → General) |
| `RENDER_API_KEY`, `RENDER_WORKER_SERVICE_ID` | Render → Account → API Keys; the worker service's ID (`srv-…`) |
| `APP_BASE_URL` | The staging web URL, https |
| `STAGING_DOMAIN` | Optional: a custom domain for staging |
| `SYNTHETIC_USER_EMAIL`, `SYNTHETIC_USER_PASSWORD` | A test account for the smoke tests, on a business domain (free mail is refused, D-27) |
| `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` | The `github-actions-staging` identity's credentials, stored in its own project (docs/16) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_*` | **Leave unset.** The worker refuses to start in staging when they are set (D-11) |

Sign-in providers are not Infisical secrets. In the staging Supabase project, under Authentication → Providers, add
Google and Microsoft (organizations tenant) with their own OAuth apps. Under Authentication → Hooks, enable "Before
User Created" (D-27, T-109).

## 4. GitHub
1. Settings → Environments → **staging**: deployment branches = `main` only. Add the environment secrets
   `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` (`github-actions-staging`), and the environment variable
   `INFISICAL_PROJECT_ID` (the staging project's ID).
2. Actions → **doctor** → Run workflow with `staging` and `all` ticked, `strict` not ticked. Every name must be present.
   Only `postgres`, `supabase-grants` and `app` may skip before the first deploy.
3. Settings → Variables → set **`STAGING_DEPLOY_ENABLED`** = `true`. Run **deploy-staging** once by hand.
4. Run **doctor** again with `all` and `strict` ticked. Link that run on T-010's issue.

## 5. Then, for gate G6
- In the staging Supabase project, give Alex Retzlik's user `"nutrivo_staff": true` in its app metadata. He enrols an
  authenticator app at first sign-in to /admin.
- Tell a Claude session that staging is up. It fills the review queue (EUR-Lex fetch, importers, K01/K02 against
  staging; docs/12). Alex then works the queue (T-208).
