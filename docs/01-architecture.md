# 01 · Architecture

```
 Browser · Next.js (Vercel, functions in Frankfurt)
   │ reads: supabase-js under RLS            │ writes: app.* RPCs (security definer)
   ▼                                        ▼
 ┌──────────────── Supabase · eu-central-1 (Frankfurt) ────────────────────────────────────────────┐
 │ Postgres: app (tenant, RLS) · ref (shared rules, coverage, terms) · private (helpers) · public    │
 │ Auth (TOTP MFA, aal claim) · Storage (private buckets) · Realtime · Queues (pgmq) · pg_cron      │
 │ Edge Functions, only three: verify · supplier-upload · stripe-webhook                            │
 └───────────────▲──────────────────────────────────────────────▲─────────────────────────────────┘
                 │ pgmq read / ack, service role, idempotent writes│ Stripe webhooks
 ┌───────────────┴───────────────────────────┐            ┌──────┴──────┐
 │ worker · Python 3.12 · Render (Frankfurt) │            │ Stripe      │
 │ extraction · rules engine · model calls · │            │ Billing+Tax │
 │ report PDFs · email · exports · content   │            └─────────────┘
 └──────┬──────────────────┬─────────────────┘
        ▼                  ▼
 AWS Bedrock (Claude, EU)  AWS SES (eu-central-1)      Sentry EU · PostHog EU · Langfuse EU
```

## Why this shape
- **One database is the system of record and enforces the invariants.** Tenancy, insert-only history, "no rule,
  no verdict", registration state, roll-up and the affected-object query live in Postgres, where the gates test them.
- **One worker does everything heavy.** Supabase Edge Functions are capped at 256 MB of memory and 2 s of CPU per
  request (verified in Supabase's docs source, 8 Oct 2026), so PDF parsing, rendering and model calls run in a
  Python container. Python has the best PDF and font tooling.
- **Queues in Postgres.** pgmq keeps job state next to the data in the EU, with no extra vendor. Messages carry only
  a job id; state lives in `app.jobs`.
- **No API layer.** Reads go through RLS; writes through a small set of RPCs. A REST layer would add a second place
  for business logic with no benefit at this scale.

## Main flows
1. **Label check.** Signed upload → `app.register_artwork` (allowance, dunning, idempotency) → `extract` job →
   panels, languages, text objects with both heights → person confirms classification → `app.request_check` →
   `check` job: per node × panel, applicable rules → evaluators → `app.checks` + findings in one transaction →
   `app.product_nodes` updated → Realtime → report → PDF → reference → public verification.
2. **Content.** Stored official source → two independent extractions → review queue → a person accepts →
   fixtures → ruleset release (immutable) with coverage, gaps and typed diffs.
3. **Change.** Release with non-editorial diffs → `diff_fanout` job → `app.affected_objects` → alerts per product ×
   node → scoped re-check of only the changed rules → supersession of affected documents (material changes only).
4. **Money.** Stripe Checkout (tax ID, automatic tax) → webhook → `app.payment_events` → subscription mirror →
   dunning schedule → `new_artwork_stopped` on day 14, never deletion.

## Environments
Local (`supabase start`, worker and web on the laptop) → staging (Supabase staging, Render staging, Vercel preview;
deploys on merge once `STAGING_DEPLOY_ENABLED` is true, from T-010) → production (a `v*` tag created by the owner,
once `PRODUCTION_DEPLOY_ENABLED` is true: docs/22 §4). Claude Code only ever touches local.
