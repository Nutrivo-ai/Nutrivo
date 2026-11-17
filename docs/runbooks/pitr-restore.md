# Restore production from point-in-time recovery

The last resort for lost or corrupted data in `nutrivo-prod`. It overwrites the production database with its state at
a chosen moment, so everything written after that moment is lost. The monthly drill ([restore-drill.md](restore-drill.md))
proves the backups restore into a new project; this runbook is the real recovery, in place, which keeps the project
ref, keys, Edge Functions, Storage and Auth settings, so the web app, the worker and the functions keep working
afterwards. Only a founder does it, in the Supabase dashboard.

## 1 · Decide
Restore only when rows cannot repair the damage. Insert-only tables (docs/03) are corrected with new rows, never by
updates or deletes, and a bad migration is fixed forward ([rollback.md](rollback.md)). A restore is for data that is gone
or that no correction can make right, for example a destructive statement that ran against production.

**Open (#84):** who may decide to restore. Default: both founders agree on the incident issue first.

Write on the incident issue (label `incident`) before starting:
- the restore point, in UTC: the last moment known good, ideally just before the damage;
- what will be lost, as counts: everything written after the point. That includes new sign-ups and workspaces (Auth
  lives in the same database), checks, findings and reports, audit events, Stripe events and jobs;
- reports issued after the point. Their references will stop resolving on `/verify`, because the `app.reports` rows
  are gone while the PDFs were sent. **Open (#84):** how to treat them (non-negotiable 9: verification outlives the
  subscription). Default: before restoring, export the list of references issued after the point (counts and
  references only) to the incident issue, and decide with the customers concerned whether they are re-issued.

Optional, and worth it when the right point is unclear: restore the same point into a new project first
([restore-drill.md](restore-drill.md) Each month, step 1) and look at it there. Delete that copy afterwards.

## 2 · Restore
1. **Stop the worker**, so no job writes to a database that is about to be replaced: Render → Render service
   `nutrivo-worker-prod` → Suspend. The worker drains its jobs in flight on SIGTERM (docs/18).
2. **Hold releases:** do not create a `v*` tag until §3 is done.
3. Supabase → `nutrivo-prod` → Database → Backups → Point in time → choose the restore point → Restore. The project is
   unavailable while it restores; the web app and `/verify` fail meanwhile.
4. Wait until the dashboard shows the project healthy again.

What the restore does not change:
- **Storage files.** Objects stored after the point stay in Storage, but the rows that point at them are gone. They
  are orphans: leave them, and note their count on the issue. Nothing reads an object without its row.
- **Stripe.** Stripe keeps the truth for subscriptions. Stripe retries webhook deliveries that failed while the project
  was down, `app.record_stripe_event` ignores an event it has already stored, and the daily reconciliation (monitor
  `stripe-reconcile`, docs/08) corrects the subscription mirror from the Stripe API.
- **Emails already sent** (invitations, document requests, reminders). A link in one of them may now point at a row that no
  longer exists; the person asks again.
- **Sentry, Langfuse and PostHog** keep their data from after the point.

## 3 · Bring it back
1. **Schema.** If the restore point is older than the last release's migrations, the schema is now behind the web app
   and the worker. Open the last Actions → `release-production` run and choose Re-run all jobs: it pushes the missing
   migrations and redeploys the same commit. Otherwise skip this step.
2. **Worker:** Render → Render service `nutrivo-worker-prod` → Resume. Jobs that were queued or running at the restore
   point run again: handlers are idempotent (docs/18), and the reaper (monitor `job-reaper`) requeues any left in
   `running`.
3. **Scheduled runs:** pg_cron is in the restored database and resumes by itself. Watch monitors `stripe-reconcile`,
   `dunning`, `expiry-reminders`, `alert-sweep` and `rate-counter-purge` check in on their next run.
4. **Prove it:**
   - Actions → `doctor` with env `prod`: every check green, including doctor check `pitr` (point-in-time recovery is
     still on after the restore) and doctor check `postgres`.
   - Actions → `synthetic` passes.
   - `/verify` resolves a reference issued before the restore point (`public.verify_reference`).
5. **Record it** on the incident issue: the restore point, start and end times, the counts lost, the orphaned Storage
   objects and what customers were told ([incident-response.md](incident-response.md) §2 step 4). Then close it as in
   [incident-response.md](incident-response.md) §5.
6. The next monthly drill restores from a point after this restore, so it also proves that backups continue.
