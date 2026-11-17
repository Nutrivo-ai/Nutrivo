# 17 · Observability (Sentry, Langfuse, PostHog)

Every failure is seen within minutes, every model call can be explained later, and the doctor proves all of it works.

## Sentry: errors, performance, crons
- **Projects and setup.**
  - Projects `SENTRY_PROJECT_WEB` (@sentry/nextjs: client, server and edge) and `SENTRY_PROJECT_WORKER` (sentry-sdk),
    plus `nutrivo-functions` for the stripe-webhook Edge Function (@sentry/deno, DSN `SENTRY_DSN_FUNCTIONS`).
    The function sends only the failures Stripe retries (`misconfigured`, `db_unreachable`, `db_error`,
    `exception`), as a message tagged with the event id, type and outcome. It has no default integrations, no request
    and no payload; its environment and release are `NUTRIVO_ENV` and `NUTRIVO_RELEASE`.
  - Environment = dev / staging / prod; release = the git SHA. CI uploads web source maps with
    `SENTRY_AUTH_TOKEN` and marks deploys.
  - Trace sample rate: 1.0 in staging, 0.2 in production.
- **Privacy.** `send_default_pii` is off, and a `before_send` scrubber removes label text, emails and tokens.
- **Tags on every event:** release, environment, `workspace` (a hash, never the name), `job_kind`, `job_id`,
  `ruleset_version`, `request_id`.
- **Cron monitors (check-ins).** Every scheduled job has exactly one monitor, named in `config/monitors.yaml`
  (T-1102). `scripts/monitors/test_monitors.py` (the protocol check) fails when a pg_cron schedule, a worker
  `*_MONITOR` or a scheduled workflow has no entry, when a schedule differs between pg_cron, the worker's
  `monitor_config` and the registry, when a workflow's own cron or its check-in schedule differs from the registry, when a
  workflow does not check in to its slug, or when this list does not name it.

  | Monitor | Job | Schedule (UTC) | Project |
  |---|---|---|---|
  | `worker-heartbeat` | worker job loop | every minute; an issue after 5 missed | worker |
  | `job-reaper` | worker reaper pass | every 5 min | worker |
  | `source-watch` | `nutrivo sources watch` (J01) | none yet: check-ins only until a weekly scheduler exists (a db or infra task), which adds the schedule (Monday, docs/12) so no missed run is reported for a run nothing makes | worker |
  | `stripe-reconcile` | pg_cron `stripe-reconcile` → `billing_reconcile` job (T-702) | 03:17 daily | worker |
  | `dunning` | pg_cron `dunning` (T-704) | 07:41 daily | worker |
  | `expiry-reminders` | pg_cron `expiry-reminders` (T-803) | 06:23 daily | worker |
  | `rate-counter-purge` | pg_cron `rate-counter-purge` → `rate_purge` job, deletes RPC rate counters older than two days (T-1103) | 02:53 daily | worker |
  | `alert-sweep` | pg_cron `alert-sweep` → `diff_fanout` sweep (J03, T-901) | 07:23 daily | worker |
  | `synthetic-smoke-prod` | workflow `synthetic.yml`, once `SYNTHETIC_ENABLED` (docs/22 §4) | every 15 min, margin 30 min; an issue after 2 missed or failed runs in a row, because GitHub often starts a `*/15` schedule 10–30 minutes late or drops a run | web |
  | `nightly-staging` | workflow `nightly.yml`, its last job: ok only when the acceptance and load jobs passed; once `STAGING_DEPLOY_ENABLED` | 02:00 daily, margin 5 h | web |
  | `restore-drill-prod` | the restore drill (`restore-drill.yml`, T-1101), started by a founder; the workflow's own schedule (the 2nd) only opens a reminder issue | the 1st monthly, margin 14 days | web |

  A missed or error check-in opens an issue (category Cron), which the "Missed or failed cron" alert routes. Workflows
  check in with `sentry-cli monitors run <slug>`, authorised by the web project's DSN, and declare their schedule on
  every run, so the monitor exists from the first run and never before.
- **Synthetic check (T-1102).** `scripts/synthetic/check.py`, every 15 minutes in the `production` environment, only
  when the repository variable `SYNTHETIC_ENABLED` is `true` (otherwise the schedule skips the job and nothing runs).
  Run workflow always runs the check, so a founder can see it pass before the switch; while the switch is off that run
  does not check in, so the monitor is created by the first scheduled run, never before. It
  reads production's critical paths, each tried twice before it fails:
  - `GET /api/health`: 200, `{"status":"ok"}` and an `x-request-id`;
  - `GET /sign-in`: 200 and an HTML page;
  - the `verify` Edge Function with the anon key, as the `/verify/[ref]` page calls it: a well-formed reference that
    was never issued must answer exactly `{"status":"unknown"}`, which needs the function and
    `public.verify_reference` to answer (503 means the database did not). With the optional prod secret
    `SYNTHETIC_VERIFY_REF` (a report of the synthetic workspace), that reference must answer `current` or `superseded`.
  It prints one line per path (ok or FAILED, status, time), never a key, reference, URL or body.
- **Alerts (T-1102).** Routing is code: `config/sentry-alerts.yaml`, applied by `scripts/sentry/alerts.py` from the
  dispatch-only workflow `sentry-alerts.yml` (production environment; `check` is read-only, `apply` creates or updates
  the rules it names by name). The Sentry token needs alerts:write. Recipients are the members of one Sentry team, by
  email; its slug is the repository variable `SENTRY_ALERT_TEAM` (default `nutrivo`). No Slack until a founder names a
  workspace and channel (#80).
  - a new issue in production (web, worker, functions) goes to the team by email, and to a GitHub issue through
    Sentry's GitHub integration;
  - an error-rate spike: more than 5% of production transactions failing over 15 minutes (web and worker);
  - a missed or failed cron, in any environment, by email;
  - p95 latency over the budgets in spec/nfr.yaml: the `/verify/[ref]` page (`verify_endpoint_p95_ms`), the board
    (`board_300_recipes_p95_ms`) and the `job:check` transaction (`check_completion_p95_s`), each over 60 minutes in
    production. Budgets with no production metric are listed under `not_alerted` with the reason and are measured by
    the nightly load run; `scripts/sentry/test_alerts.py` fails when a performance budget has neither, or when a
    threshold differs from its budget.

## Langfuse: every model call, explainable
- **Transport.** The worker uses the Langfuse Python SDK v4, which exports OpenTelemetry spans to
  `/api/public/otel/v1/traces` with `x-langfuse-ingestion-version: 4`. Nothing uses the v3 ingestion API, which
  Langfuse Cloud retires on 2026-11-16, or the retired v3 trace reads. Langfuse's AI features stay off in the
  organisation (issue #17).
- **Traces.** One trace per job (`job:<kind>:<id>`), or per unit of content work run from the CLI
  (`content:extract:<rule_key>:<source_id>`, docs/12), and one generation per model call: model id, prompt version,
  input hash, tokens, cost, latency. The trace id is derived from the job, so retries of a job share one trace. The
  same ids go to `app.model_calls`.
- **Scores.**
  - The accepting person's decision in the review queue is stored as a score on the extraction generation.
  - Claim-judgement evaluations run as Langfuse dataset runs (docs/07-ai.md, `nutrivo evals claims`).
    - Each case is a trace with the model's generation, linked to its dataset item, and scored `agreement`
      (boolean) and `outcome` (categorical).
    - Each run is scored `n`, `withheld`, `prohibited_judged_permitted`, `threshold_passed`, `kappa` and
      `agreement`.
    - Datasets, run items and scores go to the REST endpoints of the v4 SDK's API client, never the v3 ingestion
      API. Without keys nothing is sent.
- **Prompts.** worker/prompts/ is the source of truth. The worker never fetches prompts at runtime; they are mirrored
  to Langfuse prompt management with their version for comparison.
- **Data.** Panel text is sent (Langfuse EU is a listed sub-processor); names and emails never are.

## PostHog: product analytics and kill switches
- **Events:** `workspace_created`, `artwork_uploaded`, `check_completed`, `report_shared`, `checkout_started`,
  `plan_started`.
- **Feature flags as kill switches:** `ff_claim_judgement`, `ff_supplier_upload`, `ff_exports`. Session replay
  is off.
- **Only these events are sent (D-25):** `posthog-js` starts with `autocapture`, `capture_pageview`,
  `capture_pageleave`, heatmaps, dead-click capture and session recording all off, so nothing on screen (label
  text, names, emails) reaches PostHog by itself. Event properties carry ids and enums, never free text.

## Correlation
A `request_id` is created at the web edge and passed to RPCs (the `x-request-id` header, which PostgREST exposes as
the `request.headers` setting; `private.enqueue` copies it into job payloads, T-305), Sentry tags,
Langfuse trace metadata and log lines. Any incident can be followed from click to model call.

## Logs
JSON lines on stdout (Render's log stream). Fields: ts, level, msg, request_id, job_id, job_kind, workspace hash,
release. Never label text, never secrets.

## Worker specifics (T-008)
- **Exceptions.** A log line gives only an exception's type. Sentry and `app.jobs.last_error` keep the message only
  for `SafeError` subclasses (`nutrivo_worker.errors`), whose messages hold ids and reason codes. Any other exception
  message is redacted, because it can carry label text.
- **Scrubber.** `before_send` also:
  - drops local variables, request data, users and breadcrumb data;
  - keeps only allow-listed `extra` keys;
  - replaces emails, JWTs, provider keys and long opaque tokens with `[redacted]`.
- **Check-ins.**
  - `worker-heartbeat` is sent from the job loop every minute. Its schedule is `* * * * *`, and an issue opens after 5
    missed check-ins.
  - `job-reaper` is sent around each reaper pass (`*/5 * * * *`) as in_progress, then ok or error.
- **Without keys.** Sentry is off when `SENTRY_DSN_WORKER` is unset; Langfuse tracing is off when either key is unset
  (CI and local runs).

## Proving it works
`make doctor ENV=<env>` performs a round-trip for each service:
- **Sentry:** sends an event with a unique id to each DSN, then reads it back through the API.
- **Langfuse:** sends one span through its OpenTelemetry endpoint (`/api/public/otel/v1/traces`), then reads it back
  through `/api/public/v2/observations`. Langfuse Cloud retires the v3 ingestion API on 2026-11-16 and already answers
  410 to v3 trace reads for new projects.
- **PostHog:** sends a capture.

Once staging deploys are switched on (T-010, docs/22 §4), the staging deploy runs the same round-trip after every merge, so a broken DSN or key fails the pipeline instead of
going silent.
