# 14 · Research log

## Verified on 8 Oct 2026
| Fact | Source |
|---|---|
| Edge Functions: 256 MB memory, 2 s CPU per request, wall clock 150 s (Free) / 400 s (paid), idle timeout 150 s, so PDF work cannot run there | Supabase docs source, apps/docs/content/guides/functions/limits.mdx (github.com/supabase/supabase) |
| Regions include eu-central-1 Frankfurt, eu-north-1 Stockholm, eu-west-1 Ireland, eu-west-3 Paris, eu-central-2 Zurich, eu-west-2 London | packages/shared-data/regions.ts |
| Pro from $25/month (100k MAU, 8 GB disk, 250 GB egress, 100 GB storage included); Team from $599/month | packages/shared-data/plans.ts |
| SAML 2.0 SSO on Pro and above | guides/auth/enterprise-sso/auth-sso-saml.mdx |
| MFA with TOTP or phone; the JWT carries `aal` (aal1 / aal2) for database rules | guides/auth/auth-mfa.mdx |
| Queues are built on pgmq: guaranteed delivery, exactly once within a visibility window, RLS-controlled | guides/queues.mdx |
| PyMuPDF 1.28.2: AGPL-3.0 or Artifex commercial · pypdfium2 5.14.0: BSD-3 / Apache-2.0 · fontTools 4.66.1: MIT · pdfplumber 0.11.10: MIT · WeasyPrint 70.0: BSD · ReportLab 5.0.1: BSD · lingua 2.2.0: Apache-2.0, Python 3.12+ · anthropic 1.12.1: MIT · pgmq 1.1.4: Apache-2.0 · psycopg 3.3.6: LGPL-3.0 · stripe 16.0.0: MIT · langfuse 4.17.0: MIT | PyPI |
| next 16.4.0 (Node 20.9+) · @supabase/supabase-js 2.117.3 (Node 22+) · @supabase/ssr 0.12.7 · supabase CLI 2.120.0 · @anthropic-ai/claude-code 2.1.295 (Node 22+) · tailwindcss 4.3.3 · @playwright/test 1.64.0 · stripe 23.0.0 | npm registry |
| Claude Code: CLAUDE.md and path-scoped `.claude/rules`; skills; subagents with tools frontmatter; Stop hooks block with exit code 2 and the turn ends after 8 consecutive blocks; `Edit(path)` and `Read(path)` permission rules; native installer `curl -fsSL https://claude.ai/install.sh \| bash` | CHANGELOG.md, github.com/anthropics/claude-code |
| cloud.langfuse.com is Langfuse's EU region | Langfuse README |
| The migrations apply on PostgreSQL 16; 44 gate tests pass; removing two guards fails exactly the matching tests | Own run |
| Synthetic fixtures behave as labelled; pypdfium2 measures the clean label's net-quantity digits at 6.09–6.20 mm against 6.2 mm | Own run (pdfplumber, pypdfium2) |

## Found in the design files
- The Backend Action Register's text says seven GATE rows; its data tags thirteen. All thirteen are gates (D-08).
- BE-43 (the Compliance Worker) is deliberately after launch, after coverage (D-09).
- The Priced Ladder's Free row is stale; the three-label allowance supersedes it (Handoff §06).
- Standard with two regions is €698; a third region exists only on Advanced at €999; Basic €249; caps €374 / €749.
- The DPA draft names "Supabase on AWS Ireland"; D-02 moves hosting to Frankfurt, so the DPA must change.
- The Handoff says it "supersedes the earlier Claude Code handoff": this repository supersedes both.
- Company details for Stripe and legal pages: Sunny Ventures AB, trading as Nutrivo.ai, Karlbergsvägen 48,
  113 37 Stockholm; company number 5594297151; VAT SE559429715101.

## Still to verify (milestone 0, with web search)
1. AWS Bedrock: which Claude models are invocable from eu-central-1 or EU cross-region inference profiles, their ids
   and prices, and Bedrock's data-handling terms.
2. Anthropic API: zero data retention and any EU data-residency option, for the fallback route.
3. Current prices: Supabase compute add-ons and PITR, Vercel Pro, Render background worker (Frankfurt), AWS SES,
   Stripe Billing and Stripe Tax in Sweden, Sentry, PostHog and Langfuse at pilot volume.
4. Data regions: Sentry EU, the PostHog EU host, Vercel function region fra1, Render Frankfurt.
5. Hosted Supabase: pgmq and pg_cron availability on Pro; exposing the `app` and `ref` schemas.
6. Legal sources: each CELEX number in content/sources.yaml and its latest consolidated version; the current
   edition and download format of the EU Register of Feed Additives.
7. Article and paragraph references in content/candidates/eu-core.yaml.
8. Event dates: Breakit, Slush, TechArena.
9. EU AI Act: counsel's confirmation that label checking is not an Annex III high-risk use.

## Conflicts for the founders
(Filled in by milestone 0.)
