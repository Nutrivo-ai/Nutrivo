# 17 · Observability (Sentry, Langfuse, PostHog)

Every failure is seen within minutes, every model call can be explained later, and the doctor proves all of it works.

## Sentry: errors, performance, crons
- **Projects and setup.**
  - Projects `SENTRY_PROJECT_WEB` (@sentry/nextjs: client, server and edge) and `SENTRY_PROJECT_WORKER` (sentry-sdk).
  - Environment = dev / staging / prod; release = the git SHA. CI uploads web source maps with
    `SENTRY_AUTH_TOKEN` and marks deploys.
  - Trace sample rate: 1.0 in staging, 0.2 in production.
- **Privacy.** `send_default_pii` is off, and a `before_send` scrubber removes label text, emails and tokens.
- **Tags on every event:** release, environment, `workspace` (a hash, never the name), `job_kind`, `job_id`,
  `ruleset_version`, `request_id`.
- **Cron monitors (check-ins):**
  - `worker-heartbeat`, every minute;
  - `job-reaper`, every 5 min;
  - `stripe-reconcile` and `dunning`, daily;
  - `expiry-reminders`, daily;
  - `synthetic-smoke-prod`, every 15 min after launch.
  A missed check-in alerts.
- **Alerts:**
  - a new issue in production goes to email or Slack, and to a GitHub issue through Sentry's GitHub integration;
  - an error-rate spike;
  - a missed cron;
  - p95 latency over the budgets in spec/nfr.yaml.

## Langfuse: every model call, explainable
- **Traces.** One trace per job (`job:<kind>:<id>`) and one generation per model call: model id, prompt version,
  input hash, tokens, cost, latency. The same ids go to `app.model_calls`.
- **Scores.**
  - The accepting person's decision in the review queue is stored as a score on the extraction generation.
  - Claim-judgement evaluations run as Langfuse dataset runs (docs/07-ai.md).
- **Prompts.** worker/prompts/ is the source of truth. The worker never fetches prompts at runtime; they are mirrored
  to Langfuse prompt management with their version for comparison.
- **Data.** Panel text is sent (Langfuse EU is a listed sub-processor); names and emails never are.

## PostHog: product analytics and kill switches
- **Events:** `workspace_created`, `artwork_uploaded`, `check_completed`, `report_shared`, `checkout_started`,
  `plan_started`.
- **Feature flags as kill switches:** `ff_claim_judgement`, `ff_supplier_upload`, `ff_exports`. Session replay
  is off.

## Correlation
A `request_id` is created at the web edge and passed to RPCs (as a setting), into job payloads, Sentry tags,
Langfuse trace metadata and log lines. Any incident can be followed from click to model call.

## Logs
JSON lines on stdout (Render's log stream). Fields: ts, level, msg, request_id, job_id, job_kind, workspace hash,
release. Never label text, never secrets.

## Proving it works
`make doctor ENV=<env>` performs a round-trip for each service:
- **Sentry:** sends an event with a unique id to each DSN, then reads it back through the API.
- **Langfuse:** sends one span through its OpenTelemetry endpoint (`/api/public/otel/v1/traces`), then reads it back
  through `/api/public/v2/observations`. Langfuse Cloud retires the v3 ingestion API on 2026-11-16 and already answers
  410 to v3 trace reads for new projects.
- **PostHog:** sends a capture.

Once staging deploys are switched on (T-010, docs/22 §4), the staging deploy runs the same round-trip after every merge, so a broken DSN or key fails the pipeline instead of
going silent.
