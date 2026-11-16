"""Tests for the restore drill (T-1101): a fake Management API, no keys, no network.
Run: python3 -m unittest discover -s scripts/drill -p 'test_*.py'"""
import json, unittest
from datetime import datetime, timedelta, timezone

import restore_drill as rd

NOW = datetime(2026, 11, 16, 10, 0, tzinfo=timezone.utc)
POINT = NOW - timedelta(hours=2)
PROD, COPY = "prodref000000000000", "drillref00000000000"


class FakeApi:
    """Answers like the Management API for prod and one drill copy; records every call."""

    def __init__(self, **over):
        self.calls = []
        self.projects = {
            PROD: {"ref": PROD, "name": "nutrivo-prod", "organization_id": "org1", "region": "eu-central-1",
                   "created_at": "2026-01-01T00:00:00Z", "status": "ACTIVE_HEALTHY"},
            COPY: {"ref": COPY, "name": "nutrivo-prod-restore", "organization_id": "org1", "region": "eu-central-1",
                   "created_at": (NOW - timedelta(hours=1)).isoformat(), "status": "ACTIVE_HEALTHY"},
        }
        self.projects[COPY].update(over.pop("copy", {}))
        self.statuses = over.pop("statuses", None)
        self.rows = {
            (COPY, "migrations"): [{"n": 120, "latest": "20261110000001"}],
            (PROD, "migrations"): [{"n": 121, "latest": "20261112000001"}],
            (COPY, "rls_off"): [{"tables": []}],
            (COPY, "counts"): [{"t": "audit_events", "n": 900}, {"t": "workspaces", "n": 3}],
            (PROD, "counts"): [{"t": "audit_events", "n": 950}, {"t": "workspaces", "n": 3}, {"t": "newer", "n": 0}],
            (COPY, "newest_audit"): [{"at": (POINT - timedelta(minutes=4)).isoformat()}],
            (COPY, "verify"): [{"ok": True}],
            (COPY, "unschedule"): [{"n": 5}],
        }
        self.rows.update(over.pop("rows", {}))
        self.delete_status = over.pop("delete_status", 200)

    def __call__(self, method, url, token, data=None, timeout=60):
        self.calls.append((method, url, data))
        ref = url.split("/projects/")[1].split("/")[0]
        if method == "GET":
            if ref not in self.projects:
                return 404, b"{}"
            p = dict(self.projects[ref])
            if ref == COPY and self.statuses:
                p["status"] = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
            return 200, json.dumps(p).encode()
        if method == "DELETE":
            return self.delete_status, b"{}"
        key = next(k for k, sql in rd.SQL.items() if sql == data["query"])
        return 201, json.dumps(self.rows[(ref, key)]).encode()

    def queries(self, ref):
        return [(next(k for k, s in rd.SQL.items() if s == d["query"]), d["read_only"])
                for m, u, d in self.calls if m == "POST" and f"/projects/{ref}/" in u]

    def deletes(self):
        return [u for m, u, _ in self.calls if m == "DELETE"]


def run(fake, delete=True, **kw):
    api = rd.Api("sbp_test", http_fn=fake, sleep=lambda s: None, now=lambda: NOW)
    return rd.drill(api, COPY, PROD, POINT, delete=delete, **kw)


class Passes(unittest.TestCase):
    def test_a_good_copy_passes_and_is_deleted(self):
        fake = FakeApi()
        r = run(fake)
        self.assertTrue(r["passed"], r["failures"])
        self.assertTrue(r["deleted"])
        self.assertEqual(fake.deletes(), [f"{rd.API}/projects/{COPY}"])
        self.assertEqual(r["restore_point_lag_minutes"], 4)
        self.assertEqual(r["cron_jobs_unscheduled"], 5)

    def test_kept_without_delete(self):
        fake = FakeApi()
        r = run(fake, delete=False)
        self.assertTrue(r["passed"])
        self.assertFalse(r["deleted"])
        self.assertEqual(fake.deletes(), [])

    def test_prod_is_only_read(self):
        fake = FakeApi()
        run(fake)
        self.assertEqual(fake.queries(PROD), [("migrations", True), ("counts", True)])
        self.assertNotIn(f"{rd.API}/projects/{PROD}", fake.deletes())

    def test_cron_is_unscheduled_first_and_is_the_only_write(self):
        fake = FakeApi()
        run(fake)
        q = fake.queries(COPY)
        self.assertEqual(q[0], ("unschedule", False))
        self.assertTrue(all(ro for _, ro in q[1:]))

    def test_waits_for_the_copy_to_be_healthy(self):
        fake = FakeApi(statuses=["RESTORING", "COMING_UP", "ACTIVE_HEALTHY"])
        self.assertTrue(run(fake)["passed"])

    def test_report_has_counts_not_rows(self):
        md = rd.markdown(run(FakeApi()))
        self.assertIn("| audit_events | 900 | 950 |", md)
        self.assertIn("passed", md)


class Guards(unittest.TestCase):
    def refuses(self, fake, pattern, ref=COPY):
        api = rd.Api("sbp_test", http_fn=fake, sleep=lambda s: None, now=lambda: NOW)
        with self.assertRaisesRegex(rd.DrillError, pattern):
            rd.drill(api, ref, PROD, POINT, delete=True)
        self.assertEqual(fake.deletes(), [])
        self.assertEqual(fake.queries(ref), [])

    def test_never_prods_ref(self):
        self.refuses(FakeApi(), "prod's ref", ref=PROD)

    def test_never_prods_name(self):
        self.refuses(FakeApi(copy={"name": "nutrivo-prod"}), "prod's name")

    def test_same_organisation_only(self):
        self.refuses(FakeApi(copy={"organization_id": "org2"}), "another organisation")

    def test_eu_central_1_only(self):
        self.refuses(FakeApi(copy={"region": "us-east-1"}), "not eu-central-1")

    def test_fresh_copies_only(self):
        self.refuses(FakeApi(copy={"created_at": (NOW - timedelta(days=3)).isoformat()}), "older than 48 hours")

    def test_failed_restore(self):
        self.refuses(FakeApi(statuses=["RESTORE_FAILED"]), "RESTORE_FAILED")

    def test_never_healthy(self):
        fake = FakeApi(statuses=["RESTORING"])
        api = rd.Api("sbp_test", http_fn=fake, sleep=lambda s: None, now=lambda: NOW)
        with self.assertRaisesRegex(rd.DrillError, "not ACTIVE_HEALTHY"):
            rd.drill(api, COPY, PROD, POINT, wait_minutes=1, delete=True)


class Fails(unittest.TestCase):
    def fails(self, pattern, **rows):
        fake = FakeApi(rows={(COPY, k): v for k, v in rows.items()})
        r = run(fake)
        self.assertFalse(r["passed"])
        self.assertRegex(" | ".join(r["failures"]), pattern)
        self.assertFalse(r["deleted"])
        self.assertEqual(fake.deletes(), [], "a failed drill keeps the copy for a person to look at")

    def test_no_migrations(self):
        self.fails("no migrations", migrations=[{"n": 0, "latest": None}])

    def test_copy_newer_than_prod(self):
        self.fails("newer than prod", migrations=[{"n": 122, "latest": "20261120000000"}])

    def test_rls_off(self):
        self.fails("RLS is off on app tables in the copy: secrets", rls_off=[{"tables": ["secrets"]}])

    def test_empty_copy(self):
        self.fails("empty", counts=[{"t": "audit_events", "n": 0}, {"t": "workspaces", "n": 0}])

    def test_unknown_table(self):
        self.fails("tables prod does not", counts=[{"t": "audit_events", "n": 9}, {"t": "rogue", "n": 1}])

    def test_more_audit_than_prod(self):
        self.fails("insert-only", counts=[{"t": "audit_events", "n": 999}, {"t": "workspaces", "n": 3}])

    def test_audit_after_restore_point(self):
        self.fails("after the restore point", newest_audit=[{"at": (POINT + timedelta(hours=1)).isoformat()}])

    def test_verify_reference_silent(self):
        self.fails("verify_reference", verify=[{"ok": False}])


class Cli(unittest.TestCase):
    def test_missing_env_exits_2(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"SUPABASE_ACCESS_TOKEN": "", "SUPABASE_PROJECT_REF": ""}):
            self.assertEqual(rd.main(["--drill-ref", COPY, "--restore-point", POINT.isoformat()]), 2)


if __name__ == "__main__":
    unittest.main()
