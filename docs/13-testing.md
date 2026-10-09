# 13 · Testing

| Layer | Where | Run | Owner |
|---|---|---|---|
| Database gates | supabase/tests/gates/ (44 tests) | `make gates` | People only |
| Database app tests | supabase/tests/app/ | `make gates` | Claude Code |
| Worker gates | worker/tests/gates/ | `make test` (active from `.milestone` 3) | People only |
| Worker unit and handler tests | worker/tests/ | `make test` | Claude Code |
| Rule fixtures | ref.rule_fixtures | `nutrivo fixtures run --ruleset <id>` | Drafted by Claude Code, confirmed by the accepting person |
| Synthetic labels | fixtures/synth/ | `make fixtures` | Generator in the repository |
| Golden labels | fixtures/golden/ | Release gate from 30 labels | People only |
| Claims evaluations | worker/evals/claims/ | Before any claim rule joins a ruleset | Labels by people |
| Web unit and end-to-end | apps/web | `pnpm test`, `pnpm e2e` | Claude Code |

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
