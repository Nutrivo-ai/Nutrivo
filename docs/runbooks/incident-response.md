# Incident response

An incident is anything that stops a customer from getting a correct, honest result, or puts their data at risk:
production down, checks failing, verification not answering, a wrong verdict, a data leak, lost data. Staging failures
are incidents for the build, not for customers. The automatic responses are in docs/18-reliability.md; this runbook is
what a person does around them.

## 1 · Where incidents come from
| Signal | Where it shows | Opened by |
|---|---|---|
| A new production error, an error-rate spike, p95 over the spec/nfr.yaml budgets | Sentry alert (docs/17) | Sentry, with a GitHub issue through Sentry's GitHub integration |
| A missed or failed scheduled run | Sentry cron monitor alert | Sentry; the monitors are listed in §3 |
| Production smoke failing | monitor `synthetic-smoke-prod`, every 15 minutes once `SYNTHETIC_ENABLED` is set (`.github/workflows/synthetic.yml`) | Sentry |
| A failed staging deploy | An issue titled "Staging deploy failed at …", labels `incident` and `autopilot` | Actions → `deploy-staging`, which then starts Actions → `claude-autopilot` on it |
| A failed production release | An issue titled "Production release v… rolled back", labels `incident` and `needs-human` | Actions → `release-production` |
| A failed restore drill | An issue titled "Restore drill …: FAILED", labels `restore-drill` and `needs-human` | Actions → `restore-drill` ([restore-drill.md](restore-drill.md)) |
| A key that expired or was rotated | The doctor fails | Actions → `doctor` (by hand; docs/18 "Expired or rotated key") |
| A customer report | Email or a call | A founder, by hand |

## 2 · First fifteen minutes
1. **Own it.** One founder takes the incident and says so on its issue. If there is no issue yet (a Sentry alert or a
   customer report), open one with the label `incident`, and add `needs-human` while a person must act. Keep every
   note on that issue: times in UTC, what was seen, what was done. Never paste label text, customer names, emails,
   tokens or keys into it; ids, counts, Sentry links and run links only.
   **Open (#84):** who is on call and who receives alerts (docs/21 §5 "Alerts reach named people"). Default: both
   founders receive every production alert and whoever sees it first owns it.
2. **Size it.** **Open (#84):** severity levels and response times are not decided. Default, highest first:
   - *Critical:* data of one workspace visible to another, a Clear shown where a result should be withheld (CLAUDE.md
     non-negotiable 3), `public.verify_reference` not answering or answering wrongly, or data lost.
   - *Major:* the app or checks down for every workspace.
   - *Minor:* one feature or one scheduled run failing, with a workaround.
3. **Contain it.** Choose the smallest step that stops the harm:
   - A bad release (it started right after a deploy): [rollback.md](rollback.md).
   - Lost or corrupted data that rows cannot correct: [pitr-restore.md](pitr-restore.md). Insert-only tables are never
     updated or deleted to "fix" data (non-negotiable 2); a correction is a new row.
   - Anything else: fix forward (§4).
   - There is no kill switch yet. docs/17 lists PostHog flags (`ff_claim_judgement`, `ff_supplier_upload`,
     `ff_exports`), but neither the web app nor the worker reads them, so turning one off changes nothing. Until they
     are wired, a misbehaving feature is contained by a rollback or a fix forward.
4. **Tell people.** **Open (#84):** how and when customers are told (email, a status page), and the legal duties
   after a personal-data breach. Default: a founder emails the affected workspaces' admins once the impact is known,
   and a suspected breach goes to counsel the same day. These runbooks say nothing about notification deadlines: that
   is for counsel.

## 3 · By symptom
| Symptom | Look at | What to do |
|---|---|---|
| Worker not running | monitor `worker-heartbeat` (an issue after 5 missed minutes); Render service `nutrivo-worker-prod` logs | Render restarts a crashed worker by itself and pgmq redelivers its jobs (docs/18). If it keeps crashing after a release, [rollback.md](rollback.md) |
| Jobs stuck in `running` | monitor `job-reaper` | The reaper requeues jobs past the 15-minute lease; a job with no attempts left becomes `failed`. A warning for a job reaped twice points at a handler that dies mid-job: fix forward |
| A job `failed` for customers | Sentry issue tagged `job_kind` and `job_id` | The user sees "retry". Find the cause in Sentry; never mark a job succeeded by hand |
| Model provider down | Sentry errors from `nutrivo_worker.models` | Nothing to switch: claims are withheld as `model_unavailable`, never passed (D-11, docs/18). Tell affected customers if it lasts |
| Daily runs missed or failed | monitors `stripe-reconcile`, `dunning`, `expiry-reminders`, `alert-sweep` and `rate-counter-purge` | pg_cron queues them and the worker runs them; check the worker first. Each job is idempotent, so the next day's run catches up |
| Source watch failed | monitor `source-watch` (check-ins only, no schedule yet: docs/17) | A content-operations fault, not a customer one: docs/12 |
| Restore drill missed or failed | monitor `restore-drill-prod` | [restore-drill.md](restore-drill.md) |
| Production smoke failing | monitor `synthetic-smoke-prod` | Run Actions → `synthetic` by hand to confirm, then Actions → `doctor` with env `prod` to find the service |
| A key expired or rotated | Actions → `doctor` with env `prod` | Rotate it in Infisical's prod project (docs/16), then run the doctor again |
| Verification failing | `/verify` with a known reference; the `verify` Edge Function's logs in the Supabase dashboard (it does not report to Sentry) | Critical. Verification never depends on billing (non-negotiable 9): look for a deploy, a database fault or a Supabase outage |
| Stripe webhooks failing | Sentry project `nutrivo-functions`; Stripe → Developers → Webhooks | Stripe retries failed deliveries; the daily monitor `stripe-reconcile` corrects the subscription mirror from the Stripe API (docs/08) |
| Overload or rate-limit refusals | Sentry p95 alerts; customers seeing "Too many requests" (P0049 refusals are not sent to Sentry) | Limits are in the `private.rate_limits` table (docs/09, defaults pending #81); changing them is a reviewed migration, not a hand edit |
| Staging deploy failed | The "Staging deploy failed" issue and its run | The autopilot works the issue; later staging deploys wait until it is closed. A founder may run Actions → `deploy-staging` by hand to try a fix first (docs/22 §4) |
| Restore drill failed | The drill's issue | [restore-drill.md](restore-drill.md) step 5 |
| Supabase, Vercel or Render down | The provider's status page | Nothing to deploy. Note it on the issue and tell customers if it lasts |

## 4 · Fixing forward
The database is never rolled back by a deploy, and a migration is never edited after it is applied: a fault is fixed by
a new pull request (CLAUDE.md, How to work).
1. Write the fix on a branch, or give the issue to a Claude Code session: the pull request names the incident issue.
2. CI and review as for any change. On merge, Actions → `deploy-staging` deploys it to staging and runs the smoke
   suite and the doctor.
3. For production, a founder creates the next `v*` tag on main; Actions → `release-production` deploys it in the
   order database, Edge Functions, worker, web, then runs the production smoke and doctor.

## 5 · Closing
1. Prove it is over: Actions → `doctor` with env `prod` is green, and Actions → `synthetic` passes (or, for staging,
   the next `deploy-staging` run is green).
2. Write the summary on the issue: start and end (UTC), impact (workspaces affected, as a count), cause, the pull
   request that fixed it, and the follow-up tasks. Each follow-up is a new issue.
3. Close the issue. Closing a "Staging deploy failed" issue releases the staging deploys that waited for it.
4. If the incident showed a runbook was wrong, fix the runbook in the same week.
