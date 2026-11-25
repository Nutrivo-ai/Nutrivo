# Rollback

A rollback puts the previous web or worker release back. The database is never rolled back: migrations are expand,
migrate, contract, so the previous web and worker run on the current schema, and a bad migration is fixed forward
(docs/18). For lost or corrupted data, see [pitr-restore.md](pitr-restore.md).

## 1 · What happens by itself
Both deploy workflows deploy in the order database, Edge Functions, worker, web, and on failure call
`scripts/deploy/rollback.sh` with only the parts that went live.

| | Actions → `deploy-staging` | Actions → `release-production` |
|---|---|---|
| Starts | After `ci` is green on a merge to main, or by hand | A `v*` tag on a commit already on main (`.github/rulesets/release-tags.json`: repository admins only) |
| Rolls back when | A step fails, times out or is cancelled after the worker or web went live | A step fails after the worker or web went live |
| Worker | Render rollback to the deploy that was live before (recorded by `scripts/deploy/render.sh` in `.render-prev`) | The same |
| Web | `vercel rollback` to the previous production deployment of the `nutrivo-staging` project (#19); the script first checks that `VERCEL_PROJECT_ID` names that project | `vercel rollback` to the previous production deployment of `nutrivo`, after the same check |
| Edge Functions, database | Never | Never |
| Then | Opens a "Staging deploy failed at …" issue (labels `incident` and `autopilot`) and starts the autopilot on it; later merges' staging deploys are refused until it is closed | Opens a "Production release … rolled back" issue (labels `incident` and `needs-human`) |

A rollback that fails fails the job, so the run shows red. A worker deploy that was started but not confirmed live is
cancelled by `scripts/deploy/render.sh`, so it cannot go live later with nothing rolling it back.

## 2 · Rolling back by hand (founders)
Use this when a release passed its smoke tests but is bad, or when the automatic rollback failed. Open or reuse an
issue with the label `incident` first ([incident-response.md](incident-response.md)).

**Web.** Vercel → team Nutrivoai → project `nutrivo` for production, `nutrivo-staging` for staging (docs/22 §4) →
Deployments.
- Production: pick the last good production deployment → Instant Rollback. Vercel then stops giving the production
  domains to new production deployments until one is promoted; the next release does that itself
  (`scripts/deploy/vercel.sh` promotes every production deploy).
- Staging: the same on project `nutrivo-staging` (its own project since #19): its last good production deployment
  → Instant Rollback; the next staging deploy promotes itself, as in production.

**Worker.** Render → Render service `nutrivo-worker-prod` (or Render service `nutrivo-worker-staging`) → Events →
the last good deploy → Rollback. The worker drains its running jobs on SIGTERM (docs/18); pgmq redelivers any it did not
finish, and handlers are idempotent.

**Edge Functions.** There is no rollback for them in the scripts. Fix forward (§3).

**Database.** Never by hand: no `supabase db push`, no SQL edits in the dashboard to undo a migration. Fix forward with
a new migration (§3); for lost or corrupted data, [pitr-restore.md](pitr-restore.md).

## 3 · After the rollback: fix forward
1. A pull request reverts or fixes the change; it is reviewed and merged as usual, and Actions → `deploy-staging`
   deploys it to staging.
2. A founder creates the next `v*` tag on main, and Actions → `release-production` releases the fix.
3. Do not re-release an older tag to "roll back": the release starts with `supabase db push`, and the CLI refuses to
   push from a checkout that lacks migrations the database already has. Roll back by hand (§2), then fix forward.

## 4 · Proving it
1. Actions → `doctor` with env `prod` (or `staging`) is green.
2. Production: Actions → `synthetic` passes, and monitor `synthetic-smoke-prod` checks in.
3. Note the rollback, what is live now and the fixing pull request on the incident issue, then close it
   ([incident-response.md](incident-response.md) §5).
