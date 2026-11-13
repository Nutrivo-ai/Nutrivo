# 13 · Testing

| Layer | Where | Run | Owner |
|---|---|---|---|
| Database gates | supabase/tests/gates/ (44 tests) | `make gates` | People only |
| Database app tests | supabase/tests/app/ | `make gates` | Claude Code |
| Worker gates | worker/tests/gates/ | `make test` (active from `.milestone` 3) | People only |
| Worker unit and handler tests | worker/tests/ | `make test` | Claude Code |
| Rule fixtures | ref.rule_fixtures, plus the golden labels from 30 (synthetic labels never, D-32) | `nutrivo fixtures run --draft <id>` before a release, recorded for the gate; `--ruleset <id>` read only (docs/05 §The runner; JSON and JUnit for CI) | Drafted by Claude Code, confirmed by the accepting person |
| Synthetic labels | fixtures/synth/ | `make fixtures` | Generator in the repository |
| Demo seed (Halden Pet Nutrition) | supabase/tests/app/fixtures/demo_halden.psql; tests in 10_demo_seed | `supabase/seed/demo/load.sh` | Claude Code |
| Golden labels | fixtures/golden/ | Release gate from 30 labels | People only |
| Claims evaluations | worker/evals/claims/ | Before any claim rule joins a ruleset | Labels by people |
| Worker database tests | worker/tests/*_pg.py via tests/pgtest.py | `make test` (local stack); required in CI | Claude Code |
| Web unit and end-to-end | apps/web | `pnpm test`, `pnpm e2e`; `make e2e` runs the full stack | Claude Code |
| Conformance report and ratchet | scripts/conformance/ (tests in test_report.py) | `make conformance`; CI's `conformance` | Claude Code |
| Load test and budgets (T-1105) | apps/web/tests/load/, scripts/load/, worker/tests/test_nfr_reliability.py | `make load PROFILE=local\|ci`; `make budgets`; staging only in nightly.yml | Claude Code |
| Repository scripts | scripts/env/test_*.py, scripts/doctor/test_*.py | `make verify-fast`; CI's `protocol` check | Claude Code |

## The 13 gates (Backend Action Register rows tagged GATE)
The register's text says seven; its data tags thirteen. All thirteen are treated as gates.
| Gate | Test |
|---|---|
| BE-02 RLS on every app table, default deny | 01_tenancy |
| BE-04 Signing grants never implied, never to externals | 01_tenancy |
| BE-05 Insert-only, including for the service key and the owner | 02_record |
| BE-06 Actor state stamped at write time | 01_tenancy |
| BE-08 Stable rule identity across versions | 02_record |
| BE-10 Coverage table with typed gaps | 03_verdict |
| BE-14 Registration state apart from label state | 03_verdict |
| BE-17 Both height measurements per text object | worker/tests/gates (milestone 3) |
| BE-21 No rule, no verdict | 03_verdict |
| BE-23 Applied, passed and withheld recorded per check | 02_record |
| BE-28 Verification with no table access | 01_tenancy |
| BE-32 The three-label allowance counter | 04_billing |
| BE-36 Dunning that never deletes | 04_billing |
Also covered: BE-01, BE-03, BE-07, BE-15, BE-16, BE-18, BE-24, BE-29.

Proof the gates bite (8 Oct 2026): removing `private.verdict_guard` and the audit insert-only trigger made exactly
the matching three tests fail; restoring them made all 44 pass.

## Milestone gating
`@pytest.mark.milestone(n)` tests skip until `.milestone` reaches n. People bump `.milestone`; Claude Code cannot.

## Load test and the budgets of spec/nfr.yaml (T-1105)
Every budget in spec/nfr.yaml has a test that names it: `[nfr:<section>.<key>]` in a Playwright title, or
`test_nfr_<section>_<key>` in pytest and unittest. `scripts/load/test_budgets.py` (verify-fast, CI's protocol check)
fails when a budget has none.

| Budget | How it is measured | Where |
|---|---|---|
| `performance.rpc_p95_ms` | p95 of five RPCs (`rollup_state`, `live_billable_counts`, `billing_context`, `set_intended_claims`, `set_formula_lines`) under a member's session, `concurrency` in flight | tests/load/1-performance |
| `performance.board_300_recipes_p95_ms` | p95 of `/w/<ws>/board`, server-rendered with the grid, for a workspace of `recipes` products in `markets_per_recipe` EU markets | tests/load/1-performance |
| `performance.search_300_recipes_p95_ms` | Withheld `not_built`: search (F02, BE-41) is after launch | tests/load/1-performance |
| `performance.extraction_10_pages_p95_s` | A ten-page artwork (the synthetic labels joined) uploaded and registered; the extract job's created_at to its terminal update | tests/load/1-performance |
| `performance.check_completion_p95_s` | `request_check` on that artwork; the check job's created_at to its terminal update | tests/load/1-performance |
| `performance.verify_endpoint_p95_ms` | p95 of the `verify` Edge Function for an issued reference, paced under its per-instance limit; 429s counted apart | tests/load/1-performance |
| `performance.public_pages_lcp_s` | p95 of Largest Contentful Paint over the public pages and a verification page, each in a fresh browser context (1366 × 768, no throttling) | tests/load/1-performance |
| `availability.*_monthly_percent` | Stand-in: the load run's own success ratio per service. The monthly figure needs 30 days of the synthetic monitor (#83 Q5) | tests/load/2-operations |
| `cost.model_cost_per_check_eur_p95` | Sum of `app.model_calls.cost_eur` per check job of the run; withheld while `cost_eur` is unpriced (#17) | tests/load/2-operations |
| `quality.*`, `security.*` | What the repository enforces: thresholds read from nfr, no quarantine tag, conformance `--enforce`, gitleaks, the nightly audit at level high | scripts/load/test_budgets.py |
| `reliability.*` | The worker's Settings and job loop against each value; `job_visibility_timeout_s` is a strict expected failure until #83 Q1 is decided | worker/tests/test_nfr_reliability.py, scripts/load/test_budgets.py |

Profiles live in config/load/profiles.yaml. `local` is full size against `supabase start`, the worker and the web's
production build (scripts/load/run.sh starts them, as scripts/ci/e2e.sh does). `ci` is reduced, in ci.yml's `load`
job (not required). `staging` is full size, in nightly.yml's `staging-load`, and run.sh refuses it outside GitHub
Actions. Each profile names the budgets it enforces. The others are reported in reports/LOAD.md and the job summary
as met, exceeded, withheld (with a reason, never counted as met) or staging_only. A budget with no result fails every
profile.
