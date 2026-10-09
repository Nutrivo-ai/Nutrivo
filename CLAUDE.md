# CLAUDE.md · Nutrivo

Nutrivo checks pet-food labels against encoded EU feed law and says, per market and per printed language panel,
what is compliant, what needs action and what was not assessed, with the rule, citation and provenance behind
every result. The product is honest by construction: no rule, no verdict.

## Stack
- Supabase in eu-central-1 (Frankfurt): Postgres schemas `app` (tenant data, RLS), `ref` (shared reference data),
  `private` (helpers, never exposed), `public` (only `verify_reference` and `coverage_snapshot`); Auth with TOTP MFA;
  Storage; Realtime; Queues (pgmq); pg_cron. Edge Functions only for `verify`, `supplier-upload`, `stripe-webhook`.
- `apps/web`: Next.js App Router, TypeScript, Tailwind, @supabase/ssr. Reads under RLS; writes only through RPCs.
- `worker/`: Python 3.12 with uv, one container. Consumes pgmq: extraction, rule evaluation, model calls, report
  PDFs, email, exports, content scripts.
- Models: Claude via AWS Bedrock (EU) or the Anthropic API, only through `nutrivo_worker.models`.
- Billing: Stripe Billing + Stripe Tax. Observability: Sentry (EU), PostHog (EU), Langfuse (EU).

## Commands
`make bootstrap` · `make db-start` · `make db-reset` · `make gates` · `make test` · `make fixtures` ·
`make typegen` · `make verify-fast` (the Stop hook runs this) · `make verify`

## Non-negotiables. If a task seems to need breaking one, stop and ask.
1. Tenant data is reachable only through RLS keyed to workspace_id. Every new table in `app` ships with RLS on,
   a read policy using the `private` helpers, no client write grants, and a pgTAP test, in the same change.
2. Insert-only tables are never updated, deleted or truncated (list in docs/03-data-model.md). Corrections are rows.
3. No rule, no verdict. A node × domain that is not fully encoded yields withheld findings with a reason code and
   gap_id, never Clear. The database enforces it in `private.verdict_guard`; never work around it.
4. Results are per language panel. Claims are judged on the printed target-language string, never on English
   then translated.
5. Every finding carries provenance (deterministic_rule · model_judgement · authored_definition · not_assessed)
   and a rule_key or gap_id. Every check pins ruleset_version and the artwork hash.
6. The model never decides coverage, never authors rules and never produces a verdict without a rule_key.
   Model findings carry confidence and may abstain; abstention is withheld, never passed.
7. You never write regulatory content from memory. Rules, terms, obligations and coverage come from stored
   official sources through the K01–K05 tooling and are accepted by a person. You never set status 'accepted'.
8. Registration state is separate from label state; an unknown registration never displays as Clear.
9. Verification outlives the subscription: billing, dunning or closure never affect `public.verify_reference`.
10. Customer data stays in the EU services in docs/02-decisions.md. Never add a vendor or sub-processor unasked.
11. Never deploy or touch staging or production yourself: CI deploys after review. Never `supabase link`, `db push`,
    `functions deploy` or `vercel`, and never merge or approve a pull request.
12. Never edit `supabase/tests/gates/**`, `worker/tests/gates/**`, `fixtures/golden/**`, `content/accepted/**`
    or `.milestone`. They are the oracle. If one looks wrong, stop and explain why.

## How to work
- Start every milestone in plan mode. Name the workflow files (docs/workflows/*.md) and BE rows the plan covers.
- Database first, then worker, then UI. The smallest vertical slice that runs end to end.
- Write paths copy the pattern in `supabase/migrations/20261008000005_functions.sql`: security definer,
  `set search_path = ''`, permission check first, one transaction, `private.write_audit`, `private.enqueue`.
- Never edit an applied migration: `supabase migration new <name>`, then `make db-reset gates typegen`.
- Job payloads hold ids only, never secrets or tokens: members can read their own jobs.
- Screens follow design/ exactly, with tokens from docs/10-design-system.md. If an endpoint cannot return a shape
  a screen assumes (docs/04-contracts.md), stop and say so rather than working around it.
- Done means: `make verify-fast` green, new behaviour covered by tests, the workflow file's Status line updated,
  and docs changed wherever behaviour changed.
- A spec line marked OPEN or TODO(owner) means stop and ask.

## Where things are
docs/00-product · 01-architecture · 02-decisions · 03-data-model · 04-contracts · 05-rules-engine ·
06-extraction · 07-ai · 08-billing · 09-security · 10-design-system · 11-milestones · 12-content-ops ·
13-testing · 14-research-log · docs/workflows/ (71 specs, index in README.md)
design/ Claude Design files (read-only reference) · content/ sources, candidates, accepted content ·
fixtures/ synthetic and golden labels · worker/prompts/ versioned prompts

## Autonomous protocol (docs/15-build-protocol.md)
- Work only on a claimed task (`make next LANE=<lane>`), on its branch `t/T-123-name`, within its lanes. The task's
  issue lists its acceptance IDs; each gets a test with the ID in its title. `make verify-task T=<id>` before the PR.
- The target is fixed in spec/, docs/workflows/ and docs/02-decisions.md. If something is not written down, ask on the
  issue (label `needs-human`) instead of deciding. Never edit spec/, plan/ or protected files.
- Secrets: run anything that needs them through `scripts/env/run.sh <dev|staging|prod> -- <command>`. Never print,
  echo, log or commit a secret, never write .env files, never run `infisical export`, `infisical secrets` or `printenv`.
- Observability is part of done (docs/17): Sentry on every new code path (errors, transactions, cron check-ins for
  scheduled work), Langfuse on every model call through `nutrivo_worker.models`, request_id carried end to end.
- Reliability is part of done (docs/18): idempotent handlers, bounded retries, visible terminal states, expand/contract
  migrations, withhold rather than guess.
- Frontend is part of done (docs/20): every screen matches its design baseline, has every state, and passes axe and
  the no-dead-controls crawl.
