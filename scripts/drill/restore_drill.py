"""Monthly restore drill (T-1101, gate G7; docs/runbooks/restore-drill.md).

A founder restores nutrivo-prod into a new project from the Supabase dashboard (the Management API has no
restore-to-new-project endpoint; its restore-pitr overwrites the source in place). This script then proves the copy
is usable and records the drill. It:
  1. refuses any project that is not a fresh drill copy: never prod's ref or name, same organisation, eu-central-1,
     created in the last 48 hours;
  2. waits for the copy to be healthy, then unschedules its pg_cron jobs (they only enqueue ids; nothing consumes
     the copy's queues, but they stop anyway);
  3. compares the copy with prod using aggregates only, in read-only transactions: migrations, RLS on every `app`
     table, row counts per `app` table, the newest audit event against the chosen restore point, and
     public.verify_reference resolving every report issued before the restore point, run inside the copy so no
     reference leaves the database, with anon still allowed to execute it (non-negotiable 9);
  4. deletes the copy when the drill passes and --delete is given.
It prints counts and timestamps, never row data or a secret. Everything goes through the Management API, with two
tokens from the production environment:
  - SUPABASE_ACCESS_TOKEN, the deploy token scoped to nutrivo-prod, for the reads on prod (its project record and
    read-only queries);
  - SUPABASE_DRILL_ACCESS_TOKEN, made per drill and scoped to the copy's project only, for every call on the copy, the
    delete included. A restore copy gets a new ref, so the prod-scoped token cannot reach it (#392), and the prod
    token is never widened for the drill. It is a GitHub production environment secret that only restore-drill.yml
    reads, never an Infisical value, so no other production job loads it; it is revoked after the drill.
The drill token needs, on the copy only: read projects (GET /v1/projects/{ref}), run SQL
(POST /v1/projects/{ref}/database/query, read-only and the one cron.unschedule write) and delete projects
(DELETE /v1/projects/{ref}). The copy and prod stay in Supabase's EU region.
"""
import argparse, json, os, sys, time, urllib.error, urllib.request
from functools import partial
from datetime import datetime, timedelta, timezone

API = "https://api.supabase.com/v1"
REGION = "eu-central-1"            # D-02
MAX_AGE = timedelta(hours=48)      # a drill copy is made just before the drill
AUDIT_SLACK = timedelta(minutes=10)
READY, FAILED = "ACTIVE_HEALTHY", {"RESTORE_FAILED", "INIT_FAILED", "REMOVED", "PAUSE_FAILED"}
E = os.environ.get

SQL = {
    "migrations": "select count(*)::int as n, max(version)::text as latest from supabase_migrations.schema_migrations",
    "rls_off": ("select coalesce(array_agg(c.relname order by c.relname), '{}') as tables from pg_class c "
                "join pg_namespace n on n.oid = c.relnamespace "
                "where n.nspname = 'app' and c.relkind in ('r', 'p') and not c.relrowsecurity"),
    # counts only: query_to_xml runs one count(*) per table inside this single read-only statement
    "counts": ("select c.relname as t, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from app.%I',"
               " c.relname), false, true, '')))[1]::text::bigint as n from pg_class c "
               "join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'app' and c.relkind in ('r', 'p') "
               "order by 1"),
    "newest_audit": "select max(at) as at from app.audit_events",
    # Every report issued by the restore point resolves through the public function on the copy, with the issued_at
    # it was stored with; refs never leave the database. {point} is a validated timestamp, never user text.
    "verify": ("with r as (select r.created_at, public.verify_reference(r.ref) as v from app.reports r "
               "where r.created_at <= '{point}'::timestamptz) select count(*)::int as reports, "
               "count(*) filter (where v->>'status' not in ('current', 'superseded'))::int as unresolved, "
               "count(*) filter (where (v->>'issued_at')::timestamptz is distinct from created_at)::int as wrong_date, "
               "count(*) filter (where v->>'status' = 'superseded')::int as superseded, "
               "has_function_privilege('anon', 'public.verify_reference(text)', 'execute') as anon_can_execute "
               "from r"),
    "reports_by_point": ("select count(*)::int as reports from app.reports where created_at <= '{point}'::timestamptz"),
    "unschedule": "select count(cron.unschedule(jobid))::int as n from cron.job",
}


class DrillError(Exception):
    pass


RETRIES, RETRY_STATUSES = 3, {429, 500, 502, 503, 504}  # docs/18: bounded retries on transient answers only


def http(method, url, token, data=None, timeout=60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers={"Authorization": f"Bearer {token}"})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Api:
    def __init__(self, token, http_fn=http, sleep=time.sleep, now=lambda: datetime.now(timezone.utc)):
        self.token, self.http, self.sleep, self.now = token, http_fn, sleep, now

    def call(self, method, url, data=None):
        """One Management API call, retried up to RETRIES times on 429, 5xx or a dropped connection. Every call the
        drill makes is safe to repeat: reads, read-only queries, cron.unschedule over what is left, and a delete."""
        for attempt in range(1, RETRIES + 1):
            try:
                s, b = self.http(method, url, self.token, data)
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt == RETRIES:
                    raise DrillError(f"{method} {url.removeprefix(API)} did not answer after {RETRIES} attempts")
            else:
                if s not in RETRY_STATUSES or attempt == RETRIES:
                    return s, b
            self.sleep(2 ** attempt)

    def project(self, ref):
        s, b = self.call("GET", f"{API}/projects/{ref}")
        if s != 200:
            raise DrillError(f"management API returned {s} for project {ref}")
        return json.loads(b)

    def query(self, ref, sql, read_only=True):
        s, b = self.call("POST", f"{API}/projects/{ref}/database/query", {"query": sql, "read_only": read_only})
        if not 200 <= s < 300:
            raise DrillError(f"query on {ref} returned {s}")
        rows = json.loads(b)
        if not isinstance(rows, list):
            raise DrillError(f"query on {ref} returned an unexpected shape")
        return rows

    def delete(self, ref):
        s, _ = self.call("DELETE", f"{API}/projects/{ref}")
        # 404: a retried delete whose first attempt went through (the guard saw the project just before)
        if s not in (200, 404):
            raise DrillError(f"deleting {ref} returned {s}")


def parse_ts(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc) if v else None


def guard(prod_api, copy_api, drill_ref, prod_ref):
    """The only project this script ever writes to or deletes is a fresh drill copy. Raises otherwise. Prod is read
    with the prod token and the copy with the drill token, so each token only ever reaches its own project."""
    if not drill_ref or drill_ref == prod_ref:
        raise DrillError("the drill ref is prod's ref: refusing")
    prod, drill = prod_api.project(prod_ref), copy_api.project(drill_ref)
    if drill.get("name") == prod.get("name"):
        raise DrillError("the drill project has prod's name: refusing")
    if drill.get("organization_id") != prod.get("organization_id"):
        raise DrillError("the drill project is in another organisation: refusing")
    if drill.get("region") != REGION:
        raise DrillError(f"the drill project is in {drill.get('region')}, not {REGION} (D-02): refusing")
    created = parse_ts(drill.get("created_at"))
    if created is None or copy_api.now() - created > MAX_AGE:
        raise DrillError("the drill project is older than 48 hours, so it is not a fresh restore: refusing")
    return drill


def wait_healthy(api, ref, minutes):
    for _ in range(max(1, minutes * 2)):
        status = api.project(ref).get("status")
        if status == READY:
            return api.now()
        if status in FAILED:
            raise DrillError(f"the drill project is {status}")
        api.sleep(30)
    raise DrillError(f"the drill project was not {READY} within {minutes} minutes")


def counts(rows):
    return {r["t"]: int(r["n"]) for r in rows}


def drill(prod_api, copy_api, drill_ref, prod_ref, restore_point, wait_minutes=30, delete=False):
    """prod_api holds the prod-scoped token and only reads prod; copy_api holds the drill token and makes every call
    on the copy, including the one write (cron.unschedule) and the delete."""
    api = copy_api
    started = api.now()
    project = guard(prod_api, copy_api, drill_ref, prod_ref)
    healthy_at = wait_healthy(api, drill_ref, wait_minutes)
    unscheduled = api.query(drill_ref, SQL["unschedule"], read_only=False)[0]["n"]

    # Reports up to 5 minutes before the restore point: one whose transaction was still open at that point is in prod
    # but not the copy. Formatted from a datetime, never from the raw input.
    point = (restore_point - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    d = {k: api.query(drill_ref, SQL[k].replace("{point}", point))
         for k in ("migrations", "rls_off", "counts", "newest_audit", "verify")}
    p = {k: prod_api.query(prod_ref, SQL[k].replace("{point}", point)) for k in ("migrations", "counts", "reports_by_point")}
    dm, pm = d["migrations"][0], p["migrations"][0]
    dc, pc = counts(d["counts"]), counts(p["counts"])
    newest = parse_ts(d["newest_audit"][0]["at"])

    failures = []
    if dm["n"] == 0:
        failures.append("the copy has no migrations")
    if (dm["latest"] or "") > (pm["latest"] or ""):
        failures.append(f"the copy's latest migration {dm['latest']} is newer than prod's {pm['latest']}")
    if d["rls_off"][0]["tables"]:
        failures.append("RLS is off on app tables in the copy: " + ", ".join(d["rls_off"][0]["tables"]))
    missing = sorted(t for t in dc if t not in pc)
    if missing:
        failures.append("the copy has app tables prod does not: " + ", ".join(missing))
    if sum(pc.values()) and not sum(dc.values()):
        failures.append("the copy's app tables are empty")
    if dc.get("audit_events", 0) > pc.get("audit_events", 0):
        failures.append("the copy has more audit events than prod (app.audit_events is insert-only)")
    if newest and newest > restore_point + AUDIT_SLACK:
        failures.append(f"the copy's newest audit event ({newest.isoformat()}) is after the restore point")
    v, prod_reports = d["verify"][0], p["reports_by_point"][0]["reports"]
    if not v["anon_can_execute"]:
        failures.append("anon cannot execute public.verify_reference on the copy (non-negotiable 9)")
    if v["reports"] != prod_reports:
        failures.append(f"the copy has {v['reports']} reports issued by the restore point, prod has {prod_reports}")
    if v["unresolved"]:
        failures.append(f"public.verify_reference does not resolve {v['unresolved']} of the copy's reports")
    if v["wrong_date"]:
        failures.append(f"public.verify_reference gives the wrong issued_at for {v['wrong_date']} reports")
    verify = (f"{v['reports']} reports resolve ({v['superseded']} superseded)" if v["reports"]
              else "skipped: no report was issued by the restore point, so there is no reference to resolve")

    result = {
        "passed": not failures, "failures": failures,
        "drill_ref": drill_ref, "restore_point": restore_point.isoformat(),
        "copy_created_at": project.get("created_at"), "copy_healthy_seen_at": healthy_at.isoformat(),
        "cron_jobs_unscheduled": unscheduled,
        "migrations": {"copy": dm, "prod": pm},
        "newest_audit_event": newest.isoformat() if newest else None,
        "restore_point_lag_minutes": round((restore_point - newest).total_seconds() / 60) if newest else None,
        "verify_reference": verify,
        "tables": {t: {"copy": dc.get(t), "prod": pc.get(t)} for t in sorted(set(dc) | set(pc))},
        "deleted": False,
    }
    if failures:
        return result
    if delete:
        guard(prod_api, copy_api, drill_ref, prod_ref)  # again, right before the only destructive call
        api.delete(drill_ref)
        result["deleted"] = True
    result["duration_seconds"] = int((api.now() - started).total_seconds())
    return result


def markdown(r):
    lines = [f"## Restore drill: {'passed' if r['passed'] else 'FAILED'}", "",
             f"- Restore point: {r['restore_point']}",
             f"- Copy `{r['drill_ref']}` created {r['copy_created_at']}, healthy by {r['copy_healthy_seen_at']}",
             f"- Newest audit event in the copy: {r['newest_audit_event']} "
             f"({r['restore_point_lag_minutes']} min before the restore point)",
             f"- Migrations: copy {r['migrations']['copy']['n']} (latest {r['migrations']['copy']['latest']}), "
             f"prod {r['migrations']['prod']['n']} (latest {r['migrations']['prod']['latest']})",
             f"- pg_cron jobs unscheduled in the copy: {r['cron_jobs_unscheduled']}",
             f"- public.verify_reference: {r['verify_reference']}",
             f"- Copy deleted: {'yes' if r['deleted'] else 'no'}", ""]
    lines += [f"- ✗ {f}" for f in r["failures"]]
    lines += ["", "| app table | copy | prod |", "|---|---:|---:|"]
    lines += [f"| {t} | {v['copy']} | {v['prod']} |" for t, v in r["tables"].items()]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--drill-ref", required=True, help="the ref of the project the dashboard restore created")
    ap.add_argument("--restore-point", required=True, help="the point in time chosen in the dashboard (ISO 8601, UTC)")
    ap.add_argument("--wait-minutes", type=int, default=30)
    ap.add_argument("--delete", action="store_true", help="delete the copy when the drill passes")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    token, drill_token, prod_ref = E("SUPABASE_ACCESS_TOKEN"), E("SUPABASE_DRILL_ACCESS_TOKEN"), E("SUPABASE_PROJECT_REF")
    missing = [n for n, v in (("SUPABASE_ACCESS_TOKEN", token), ("SUPABASE_DRILL_ACCESS_TOKEN", drill_token),
                              ("SUPABASE_PROJECT_REF", prod_ref)) if not v]
    if missing:
        print("missing " + ", ".join(missing), file=sys.stderr)
        return 2
    if drill_token == token:
        print("SUPABASE_DRILL_ACCESS_TOKEN must be its own token, not the prod deploy token", file=sys.stderr)
        return 2
    restore_point = parse_ts(a.restore_point)
    try:
        r = drill(Api(token), Api(drill_token), a.drill_ref.strip(), prod_ref, restore_point, a.wait_minutes, a.delete)
    except DrillError as e:
        print(f"restore drill refused or failed: {e}", file=sys.stderr)
        return 1
    md = markdown(r)
    print(md)
    if E("GITHUB_STEP_SUMMARY"):
        with open(E("GITHUB_STEP_SUMMARY"), "a") as fh:
            fh.write(md)
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(r, fh, indent=1)
    return 0 if r["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
