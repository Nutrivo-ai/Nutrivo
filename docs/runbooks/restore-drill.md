# Restore drill (monthly)

Point-in-time recovery (PITR) is on for `nutrivo-prod` (docs/18 Backups). Once a month a founder proves that a backup
can be restored. Do the first drill before the first customer uploads anything (gate G7, T-1101).

## Why the drill is half by hand
The Supabase Management API has no endpoint that restores into a new project. Its `restore-pitr` endpoint overwrites
the source project in place, so it is never used for a drill. A restore into a new project is offered only in the
dashboard. The checks after the restore are scripted: `.github/workflows/restore-drill.yml` runs
`scripts/drill/restore_drill.py`.

## Before the first drill (once)
1. Supabase → `nutrivo-prod` → Add-ons → Point in time recovery → choose a retention. This needs a paid plan with
   physical backups on.
2. Run Actions → `doctor` → env `prod`. The `pitr` check must be green. `release-production` also runs it after every
   deploy, and a release fails it while PITR is off.
3. Know the drill token (#392). The deploy token `SUPABASE_ACCESS_TOKEN` is scoped to `nutrivo-prod` only and is never
   widened; a restore copy gets a new ref, so each drill reaches its copy with a token of its own, made per drill in
   step 3 of "Each month". It is never stored in Infisical: Infisical's prod environment is loaded into every
   production job (release, synthetic every 15 minutes, Sentry alerts), and a token that can delete a project does not
   belong there. It lives only as the GitHub `production` environment secret `SUPABASE_DRILL_ACCESS_TOKEN`, which only
   `restore-drill.yml` reads.

## Each month
Do the drill in the first two weeks of the month. The drill checks in to the Sentry cron monitor `restore-drill-prod`
(expected on the 1st, 14 days' margin, 60 minutes' runtime): a failed drill is an error check-in, and a month without
a drill is a missed one. On the 2nd, a scheduled run of the same workflow also opens a "Restore drill due" issue
(labels `restore-drill` and `needs-human`) if no drill has passed for 31 days.

1. Supabase → `nutrivo-prod` → Database → Backups → **Restore to a New Project**. Choose a point in time a few hours
   back and note it in UTC. The copy stays in eu-central-1 and is billed while it exists.
2. Wait until the new project is up, then copy its ref from the project URL.
3. Make the drill token for this copy: Supabase → Account → Access Tokens → a scoped token named
   `nutrivo-restore-drill-<date>`, with resource access on **the copy's project only** (never the organisation, never
   `nutrivo-prod`), the shortest expiry offered, and only what the drill calls:
   - read projects: `GET /v1/projects/{ref}` (the guard, and waiting for the copy to be healthy);
   - run SQL: `POST /v1/projects/{ref}/database/query` (read-only checks, and the one `cron.unschedule` write);
   - delete projects: `DELETE /v1/projects/{ref}` (the copy, after a passing drill).
   GitHub → Settings → Environments → `production` → set the secret `SUPABASE_DRILL_ACCESS_TOKEN` to it.
4. Actions → `restore-drill` → Run workflow, with the copy's ref and the point in time.
5. Afterwards, revoke the token in Supabase. The script refuses to start without it, and refuses it when it is the
   prod deploy token; prod itself is only ever read, with the deploy token, and the guard still refuses prod's ref and
   name, another organisation, another region and any project older than 48 hours.
6. The workflow does the following:
   - It refuses to run unless a repository admin started it.
   - It refuses any project that is not a fresh drill copy: never prod's ref or name, the same organisation,
     eu-central-1, created in the last 48 hours.
   - It unschedules the copy's pg_cron jobs. They start as soon as the restore completes, but they only enqueue ids,
     no worker consumes the copy, and the migrations make no `pg_net` calls.
   - It compares the copy with prod using aggregates only, in read-only transactions: the migration count and the
     latest migration, RLS on every `app` table, row counts per `app` table, the newest `app.audit_events` row against
     the point in time, and `public.verify_reference` on the copy: every report issued up to 5 minutes before the
     point in time resolves as current or superseded with its stored `issued_at`, the copy holds as many of those
     reports as prod, and `anon` may still execute the function (non-negotiable 9). The references are resolved
     inside the database and never leave it. With no report issued yet, this check is skipped and the record says so.
   - It retries a Management API call at most three times, on 429, 5xx or a dropped connection.
   - When the drill passes it deletes the copy, unless `keep` is ticked, and records the drill in a closed issue
     labelled `restore-drill`.
   - When the drill fails it keeps the copy and opens an issue labelled `restore-drill` and `needs-human`.
   - When the start is refused (not a repository admin), nothing is recorded.
7. After a failed drill, read the failures, fix the cause, and delete the copy by hand (Supabase → project →
   Settings → Delete project).

The issue holds counts and timestamps, never row data.

## What a restore does not bring back
A restore to a new project copies the database only. Storage objects, Edge Functions, Auth settings, API keys and
Realtime settings are not copied. A real recovery uses the in-place PITR restore on `nutrivo-prod` (the dashboard or
`restore-pitr`), after which the Edge Functions, worker and web keep working. That path is
[pitr-restore.md](pitr-restore.md).
