# 19 · Testing cadence: every feature is tested end to end

Every task ships its acceptance tests. Every acceptance ID in spec/acceptance.yaml is a must-pass test, and the
conformance ratchet means one that passed can never silently fail again.

## Naming tests after acceptance IDs
| Layer | Convention | Example |
|---|---|---|
| Playwright (apps/web) | ID in square brackets in the title | `test('[A01.main] sign-up creates a workspace', …)` |
| pytest (worker) | ID in the test name, dots as underscores | `def test_D04_must_1_no_rule_no_verdict():` |
| pgTAP (supabase/tests/app) | ID in square brackets at the start of the description | `select ok(…, '[A05.must.1] the last admin cannot be demoted')` |

`scripts/conformance/report.py` reads JUnit XML and TAP output, maps results to IDs, writes CONFORMANCE.md, and
fails when a baseline ID regresses (`spec/conformance-baseline.json`).

## When what runs
| When | What | Where | Blocks |
|---|---|---|---|
| Before Claude Code finishes | `make verify-fast` (Stop hook) | Laptop | Finishing the session |
| Every PR and merge-queue entry | Protocol, secrets scan, lint, types, unit, pgTAP gates and app tests, contract tests, full-stack Playwright (local Supabase, worker, web, Mailpit, recorded model responses), visual comparison with the design, axe accessibility, conformance ratchet | GitHub Actions | The merge |
| Every merge to main (once `STAGING_DEPLOY_ENABLED` is set, T-010) | Deploy to staging; `@smoke` suite; Sentry and Langfuse round-trip; doctor; rollback on failure | Staging | Later deploys until fixed |
| Nightly | The full acceptance suite against staging with real models and real email; golden labels; claims evaluations; extraction benchmark; performance budgets; schema-drift diff; doctor for every environment; dependency audit | Staging | Opens issues |
| Release (tag) | Approval; production deploy; production smoke on the synthetic workspace; rollback on failure | Production | The release |
| Every 15 minutes after launch | Synthetic smoke with a Sentry cron check-in | Production | Alerts |

## Determinism
- **Models.** CI runs in `MODELS_MODE=replay` against recorded responses in `worker/tests/cassettes/`. The nightly run
  records against real models and opens a PR when outputs change.
- **Email.** Mail goes to Mailpit in the local Supabase stack; tests read it through Mailpit's API.
- **Stripe.** Test mode. Webhooks are posted to the local function signed with the test secret.
- **Data.**
  - The demo seed reproduces the design's mock data (Halden Pet Nutrition), so screens are comparable with design
    baselines.
  - The synthetic labels provide extraction truth.
  - Golden labels are added from pilots.

## Flaky tests
A flaky test is retried once in CI. If it is still flaky, it gets the `quarantine` tag and an issue. A quarantined
acceptance test counts as failing for conformance and for launch.
