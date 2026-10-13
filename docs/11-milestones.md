# 11 · Milestones

> In the autonomous protocol (docs/15) the unit of work is a task in plan/tasks.yaml; milestones group tasks.
> The prompts below remain for manual sessions and as context for each milestone's tasks.

How to run each one: SETUP.md Step 5. A person bumps `.milestone`, which also switches on that milestone's
worker gate tests. Each prompt assumes Claude Code has read CLAUDE.md. Paste it as written, then review the plan.

| # | Milestone | Workflows | Weeks (from start) | Lands for |
|---|---|---|---|---|
| M0 | Bootstrap and verify | — | 1 | — |
| M1 | App shell, sign-in, workspace, people | A01–A07, B01, O02, N02 (switcher) | 1–2 | Breakit: live sign-up and the design system |
| M2 | Content console and first ruleset | K01–K05, J01, J02 | 2–4 (parallel) | — |
| M3 | Artwork extraction | D01, D02, C02 | 1–5 (parallel, starts week 1) | — |
| M4 | First demo path | C01, C03, C04, B02, D03, D04, D07, I01, I04 | 5–7 | Slush: upload → report → verify |
| M5 | Engine complete | D05, D06, D08, D09, F01, F04, G01, G02, G03 | 7–9 | — |
| M6 | Sharing, notifications, public pages | I02, O01, P01, P02 | 9–10 | — |
| M7 | Billing | M01–M06, B02 limits | 10–12 | First paid pilot |
| M8 | Documents, suppliers, export | H01–H04, O03 | 12–13 | — |
| M9 | Change propagation | J03, J04, J05, I05 | 13–14 | — |
| M10 | Product briefs | E01, E02, E04 | 14–15 | — |
| M11 | Hardening and launch | — | 15–16 | TechArena: paying pilots |

Event dates come from a founder email and are unverified (Breakit in October, Slush in December, TechArena in
January). If Breakit is before week 3, demo the design prototype plus the M1 sign-up and the M3 extraction spike.

---

## M0 · Bootstrap and verify
**Prompt**
```
Read CLAUDE.md, docs/00-product.md, docs/01-architecture.md and docs/02-decisions.md. This is milestone 0: bootstrap.
Plan first, then:
1. Verify every item under "Still to verify" in docs/14-research-log.md using web search. Record each finding with
   its link and today's date in that file. Never change a decision: if a finding contradicts one, add it under
   "Conflicts for the founders" and continue with the rest.
2. Scaffold apps/web with create-next-app (TypeScript, App Router, Tailwind, ESLint, src/ directory, pnpm). Add
   @supabase/ssr and @supabase/supabase-js, Vitest and Playwright, and the scripts lint, typecheck, test and e2e.
3. In worker/, run uv sync and make `uv run pytest` pass (milestone-gated tests skip).
4. Make `make verify-fast` pass locally and the CI workflow pass on a pull request.
Build no features.
```
**Done when** `make verify-fast` and CI are green; the research log is filled in with sources.
**Review** Read "Conflicts for the founders" and update docs/02-decisions.md where needed.

## M1 · App shell, sign-in, workspace and people
**Prompt**
```
Milestone 1. Implement A01, A02 (without SSO), A03, A04, A05, A06, A07, B01, O02 and the workspace switcher from N02,
as specified in docs/workflows/, using the implement-workflow skill.
Order:
(a) Design system: extract the Cobalt tokens and the four state glyphs from design/ into
    apps/web/src/styles/tokens.css and the Tailwind theme (docs/10-design-system.md). Build the component kit listed
    there and the app shell with the left rail.
(b) Auth with @supabase/ssr: email and password, magic link, email confirmation, and a TOTP enrolment screen.
(c) Onboarding: app.create_workspace, then the default operator (B01).
(d) Workspace Settings: People (invite, change, remove), Workspace, Audit log, Your account.
Add the missing RPCs (app.change_member, app.remove_member, app.revoke_invitation, app.set_default_operator) in new
migrations following supabase/migrations/20261008000005_functions.sql, with pgTAP tests in supabase/tests/app/.
Worker: the job loop (pgmq read with visibility timeout, idempotent handlers, retries) and the 'notify' handler for
invitations (generate the token, store only its SHA-256, send through the email adapter; log email in local dev)
and 'session_revoke'.
Playwright: sign up → create workspace → invite → accept as a second user → change role → remove → the removed user
loses access on the next request.
```
**Done when** gates, the new pgTAP tests and the end-to-end flow pass; each screen matches its design at 1600 px.
**Review** rls-reviewer on the new migrations. With a second account's session, try to read the first workspace
through the API (it must return nothing). Read an invitation email.

## M2 · Content console and the first ruleset
**Prompt**
```
Milestone 2. Build the internal content console at /admin and the scripts in scripts/content/, following
docs/12-content-ops.md exactly. /admin is visible only when app_metadata.nutrivo_staff is true; its server routes use
the service role only after checking that claim.
1. Source fetcher: download each act in content/sources.yaml from EUR-Lex (latest consolidated version) in EN, SV,
   DA, FI and DE; store it in the 'sources' bucket with its sha256; insert ref.sources.
2. Importers: the EU Register of Feed Additives → ref.feed_additives; the Catalogue of feed materials → 
   ref.feed_materials with every language name taken from the official language versions.
3. K01/K02: for each target in content/candidates/eu-core.yaml, two independent extractions from the stored text
   (content-extract skill) into ref.rule_candidates, with agree computed field by field.
4. Review queue: each candidate beside its verbatim source excerpt and both extractions. Accept writes ref.rules and
   ref.rule_versions (status accepted, accepted_by, source_excerpt), only on a person's click.
   Term register (K03) per language from the official versions, never translated. Coverage editor (K04).
   Glossary editor (the eleven authored definitions).
5. Ruleset release (K05): a staff-only RPC that refuses unless every member version is accepted and
   `nutrivo fixtures run --ruleset <id>` passed; it writes ref.ruleset_versions, ref.ruleset_members,
   ref.coverage_nodes, ref.coverage_gaps and typed ref.rule_diffs.
6. J01: a weekly source-watch script (EUR-Lex and the Official Journal) whose model triage proposes horizon items
   for a person to record.
You never accept anything yourself and never write a rule value from memory.
```
**Done when** three sample rules go from candidate to accepted to released with fixtures; `coverage_snapshot()`
reflects the release; pgTAP tests cover the release function.
**Review** A founder accepts the first rules personally. Run the content-verifier subagent on every candidate.

## M3 · Artwork extraction (starts in week 1, alongside M0–M2)
**Prompt**
```
Milestone 3. Build nutrivo_worker.extraction to the contract in docs/06-extraction.md until
worker/tests/gates/test_extraction_gates.py passes (run `make fixtures` first).
Start with a one-session spike comparing pypdfium2 and pdfplumber for glyph boxes, font programmes and both heights
on the synthetic fixtures; write the results under "Spike results" in docs/06-extraction.md before choosing.
Then: signed upload to artwork/<workspace_id>/<product_id>/<sha256>.pdf; app.register_artwork (exists); the
'extract' handler, idempotent by extraction_runs.idempotency_key, writing extraction_runs, artwork_panels and
text_objects with typed failures and progress over Realtime; the panel triage view (D02) over the artwork; product
creation from a dropped artwork (C02). Add the worker Dockerfile and a staging deploy to Render (Frankfurt).
```
**Done when** the extraction gates pass; all six fixtures process end to end on staging; the nine-panel fixture
shows six results and three named failures.
**Review** Upload three of your own print PDFs and inspect the panels, languages and measured heights.

## M4 · The first demo path
**Prompt**
```
Milestone 4: the first demo path. Implement C01, C03, C04, B02, D03, D04, D07, I01 and I04 per docs/workflows/.
Engine (docs/05-rules-engine.md): classification first (D03: the model suggests, a person confirms, the citation is
stored), then only the mandatory_particular and prescribed_wording evaluators; coverage read at check time; withheld
findings with reason codes and gap ids; applied, passed and withheld arrays; one app.checks row per node × language
panel written with its findings in one transaction. The database refuses Clear where coverage is incomplete; never
work around it.
Label report (the label report screens in Nutrivo 2.0): language switcher over per-panel result sets, findings
pinned on the artwork, a Not assessed section linking each item to its coverage gap.
Report PDF (I01): rendered in the worker with WeasyPrint; ruleset version, artwork hash and timestamp on its face; the
Not assessed section always present; reference = 128 random bits in base32. Public verification (I04): Edge Function
'verify' calling public.verify_reference only. Write docs/demo.md: a five-minute demo script.
```
**Done when** clean_3lang produces a report with three language result sets; missing_batch produces exactly one
action finding, on the Swedish panel; domains that are not encoded show as Not assessed with gap links; the
verification page answers "current".
**Review** Run docs/demo.md. Confirm nothing reads Clear for a domain that is not encoded.

## M5 · Engine complete
**Prompt**
```
Milestone 5. Build the claims evaluation harness first (docs/07-ai.md): no claim_judgement rule may join a ruleset
until it meets the threshold. Then add the remaining evaluators: threshold, additive_condition (against
ref.feed_additives), character_height (the height definition named by each rule) and claim_judgement (the model on
the printed target-language string only; confidence; abstention is withheld 'model_abstained'; every call through
nutrivo_worker.models). Then: registration state (D06) from ref.obligations and app.registrations, the obligations
view (G01), the registration pack checklist (G02, read-only) and recording a registration (G03); re-check on a new
artwork version (D08); coverage per product (D09); the board with grouped market columns and database roll-up
(F01, app.rollup_state); portfolio findings (F04).
```
**Done when** small_netqty yields an action finding with measured and required millimetres; the Texas case renders
Blocked on the board; the harness report is committed.
**Review** Read ten claim judgements in Langfuse in two languages. Check one obligation row against its source.

## M6 · Sharing, notifications, public pages
**Prompt**
```
Milestone 6. Implement I02, O01, P01 and P02. Share links (BE-27): unguessable, revocable, optional expiry, access
logged; revoking stops the page but never verification. Notifications: in-app with per-person read state and email
for the six templates in design/ (through SES); editorial changes never notify. Public coverage page from
public.coverage_snapshot() only: no invented numbers and no named specialists. Pricing page from config/pricing.ts,
matching the Priced Ladder and the three-label allowance.
```
**Done when** a revoked link stops working while its reference still verifies; the coverage page equals the
released coverage exactly.
**Review** Read every public page for claims the product cannot back.

## M7 · Billing
**Prompt**
```
Milestone 7. Implement M01-M05 and the plan limits per docs/08-billing.md. config/pricing.ts is the single source;
an idempotent script creates the Stripe test-mode catalogue (EUR). Checkout with automatic tax and tax-ID collection;
Edge Function 'stripe-webhook' (signature check; app.payment_events idempotent by event id; updates
app.subscriptions and app.workspaces); live billable counts in the plan picker (BE-33); the 1.5x cap that offers the
next plan instead of charging (BE-34); the dunning schedule with pg_cron (BE-36: days 0, 3, 7 notify and retry; day
14 new_artwork_stopped; never delete); the customer portal. M06 (region changes) stays a manual step in Stripe.
```
**Done when** in test mode, a German company with a valid VAT number subscribes and its invoice shows reverse charge
and zero VAT; a failed card reaches day 14 and stops only new artworks; verification still works.
**Review** Walk through checkout, invoice and a failed payment yourself in test mode.

## M8 · Documents, suppliers, export
**Prompt**
```
Milestone 8. Implement H01-H04 and O03. Document library against ref.document_requirements; supplier request links
(the worker generates the token and stores only its hash; 14-day expiry; single use); Edge Function
'supplier-upload' (token, MIME, magic bytes, 25 MB limit, quarantine bucket); a ClamAV scan in the worker, then
promotion; expiry reminders at 60, 30 and 7 days with pg_cron; full export (BE-44) of recipes, checks, findings,
reports, certificates and documents with ruleset_version on every row, as a zip with a 7-day signed URL, free on
every plan.
```
**Done when** an expired or used supplier link returns a generic error; a free workspace exports everything.

## M9 · Change propagation
**Prompt**
```
Milestone 9. Implement J03, J04, J05 and I05. On every ruleset release, a 'diff_fanout' job: for each non-editorial
rule_diff, app.affected_objects → alerts (coming or in_force, with effective_from and sell_through_until) per product
× node, read state per person. The horizon and alerts inbox (J04, Missing Surfaces), where proposals never carry an
effective date. Scoped re-check (BE-25): re-run only the changed rules on the affected panels and markets, one
append-only event per recipe (BE-42), triggered by staff. Supersession (BE-30) of reports on material changes only,
never 'invalid'.
```
**Done when** a one-rule change across N recipes creates exactly N alerts and only the scoped evaluations; an
editorial change creates nothing.

## M10 · Product briefs
**Prompt**
```
Milestone 10. Implement E01, E02 and E04. Briefs with formula lines and intended claims per language; the envelope
(E02) from accepted rules only: required particulars, permitted and prohibited wording per language, additive limits,
obligations, and withheld items with their gaps; cached by inputs_hash. Promote a brief to artwork (E04).
```
**Done when** an envelope lists withheld items honestly wherever coverage is incomplete.

## M11 · Hardening and launch
**Prompt**
```
Milestone 11. Prepare for paying pilots: run the rls-reviewer over every migration and fix findings; Supabase
security advisors clean; rate limits on RPCs and Edge Functions; dependency audit; Sentry alerts and an uptime
monitor on 'verify'; an accessibility pass to WCAG 2.2 AA (keyboard order, focus, how the four states read to a
screen reader); a load test on a 300-recipe workspace; the production deploy pipeline (a v* tag created by the
owner, once PRODUCTION_DEPLOY_ENABLED is true (docs/22 §4); migrations through GitHub Actions); point-in-time
recovery and a restore drill; legal pages from design/ with counsel's edits; a pilot onboarding runbook in
docs/pilot-runbook.md.
```
**Done when** SETUP.md Step 8 is fully ticked.

## After launch
Certificates UI and signing grants (A08, I03) · the Compliance Worker (L01–L03) once coverage is real · search and
saved views (F02) · user-started bulk re-check (F03) · SSO (A09) · Partner tier (N01, N03) · Worker proposals (E03) ·
UK and US regions · GBP and USD catalogues · OCR geometry for raster artwork.
