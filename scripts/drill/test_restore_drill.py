"""Tests for the restore drill (T-1101): a fake Management API, no keys, no network.
Run: python3 -m unittest discover -s scripts/drill -p 'test_*.py'"""
import json, unittest
from unittest import mock
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
            (COPY, "verify"): [{"reports": 40, "unresolved": 0, "wrong_date": 0, "superseded": 3,
                                 "anon_can_execute": True}],
            (PROD, "reports_by_point"): [{"reports": 40}],
            (COPY, "unschedule"): [{"n": 5}],
        }
        self.rows.update(over.pop("rows", {}))
        self.delete_status = over.pop("delete_status", 200)
        self.flaky = over.pop("flaky", [])
        self.tokens = []  # (ref, method, token) per call  # statuses or exceptions answered before the real answer

    def __call__(self, method, url, token, data=None, timeout=60):
        self.calls.append((method, url, data))
        self.tokens.append((url.split("/projects/")[1].split("/")[0], method, token))
        if self.flaky:
            f = self.flaky.pop(0)
            if isinstance(f, Exception):
                raise f
            return f, b"{}"
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
        return 201, json.dumps(self.rows[(ref, key_of(data["query"]))]).encode()

    def queries(self, ref):
        return [(key_of(d["query"]), d["read_only"])
                for m, u, d in self.calls if m == "POST" and f"/projects/{ref}/" in u]

    def deletes(self):
        return [u for m, u, _ in self.calls if m == "DELETE"]


def key_of(sql):
    """The SQL template a query was made from: the one whose text before {point} it starts with, longest first."""
    heads = sorted(((t.split("{point}")[0], k) for k, t in rd.SQL.items()), key=lambda h: -len(h[0]))
    return next(k for head, k in heads if sql.startswith(head))


def apis(fake):
    """The prod-scoped deploy token and the separate drill token, as main() builds them."""
    return (rd.Api("sbp_prod", http_fn=fake, sleep=lambda s: None, now=lambda: NOW),
            rd.Api("sbp_drill", http_fn=fake, sleep=lambda s: None, now=lambda: NOW))


def run(fake, delete=True, **kw):
    return rd.drill(*apis(fake), COPY, PROD, POINT, delete=delete, **kw)


class Tokens(unittest.TestCase):
    """#392: the prod deploy token is scoped to nutrivo-prod, so the copy is reached only with the drill token."""

    def test_each_token_reaches_only_its_own_project(self):
        fake = FakeApi()
        run(fake)
        self.assertEqual({tok for ref, _, tok in fake.tokens if ref == PROD}, {"sbp_prod"})
        self.assertEqual({tok for ref, _, tok in fake.tokens if ref == COPY}, {"sbp_drill"})

    def test_the_delete_uses_the_drill_token(self):
        fake = FakeApi()
        run(fake)
        self.assertEqual([tok for ref, m, tok in fake.tokens if m == "DELETE"], ["sbp_drill"])
        self.assertEqual([ref for ref, m, _ in fake.tokens if m == "DELETE"], [COPY])

    def test_a_drill_token_without_access_to_the_copy_refuses_and_deletes_nothing(self):
        """#392's failure: the copy answers 403 to the token that calls it. Exit 1, copy kept."""
        class Forbidden(FakeApi):
            def __call__(self, method, url, token, data=None, timeout=60):
                if f"/projects/{COPY}" in url and token == "sbp_drill":
                    self.calls.append((method, url, data))
                    self.tokens.append((COPY, method, token))
                    return 403, b"{}"
                return super().__call__(method, url, token, data, timeout)
        fake = Forbidden()
        with self.assertRaisesRegex(rd.DrillError, "403"):
            run(fake)
        self.assertEqual(fake.deletes(), [])

    def test_main_needs_the_drill_token(self):
        env = {"SUPABASE_ACCESS_TOKEN": "sbp_prod", "SUPABASE_PROJECT_REF": PROD}
        with mock.patch.object(rd, "E", env.get), mock.patch("sys.stderr"):
            self.assertEqual(rd.main(["--drill-ref", COPY, "--restore-point", POINT.isoformat()]), 2)

    def test_main_refuses_the_prod_token_as_drill_token(self):
        env = {"SUPABASE_ACCESS_TOKEN": "sbp_prod", "SUPABASE_DRILL_ACCESS_TOKEN": "sbp_prod",
               "SUPABASE_PROJECT_REF": PROD}
        with mock.patch.object(rd, "E", env.get), mock.patch("sys.stderr"):
            self.assertEqual(rd.main(["--drill-ref", COPY, "--restore-point", POINT.isoformat()]), 2)


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
        self.assertEqual(fake.queries(PROD), [("migrations", True), ("counts", True), ("reports_by_point", True)])
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
        with self.assertRaisesRegex(rd.DrillError, pattern):
            rd.drill(*apis(fake), ref, PROD, POINT, delete=True)
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
        with self.assertRaisesRegex(rd.DrillError, "not ACTIVE_HEALTHY"):
            rd.drill(*apis(fake), COPY, PROD, POINT, wait_minutes=1, delete=True)


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

    def verify(self, **over):
        return [{"reports": 40, "unresolved": 0, "wrong_date": 0, "superseded": 3, "anon_can_execute": True, **over}]

    def test_a_report_does_not_resolve(self):
        self.fails("does not resolve 2 of the copy's reports", verify=self.verify(unresolved=2))

    def test_a_report_has_the_wrong_issued_at(self):
        self.fails("wrong issued_at for 1 reports", verify=self.verify(wrong_date=1))

    def test_anon_lost_its_grant(self):
        self.fails("anon cannot execute", verify=self.verify(anon_can_execute=False))

    def test_reports_missing_from_the_copy(self):
        self.fails("the copy has 39 reports issued by the restore point, prod has 40", verify=self.verify(reports=39))


class VerifyReference(unittest.TestCase):
    def test_resolves_real_reports_inside_the_database(self):
        """Review on #265: a made-up 19-character ref always answered 'unknown', so the old probe never failed."""
        fake = FakeApi()
        r = run(fake)
        self.assertEqual(r["verify_reference"], "40 reports resolve (3 superseded)")
        sql = next(d["query"] for m, u, d in fake.calls if m == "POST" and d["query"].startswith("with r as"))
        self.assertIn("public.verify_reference(r.ref)", sql)
        self.assertIn("'2026-11-16T07:55:00+00:00'::timestamptz", sql, "5 minutes before the restore point")
        self.assertNotIn("{point}", sql)
        self.assertNotIn("restore-drill-probe", sql)

    def test_skipped_with_a_reason_when_no_report_exists_yet(self):
        none = [{"reports": 0, "unresolved": 0, "wrong_date": 0, "superseded": 0, "anon_can_execute": True}]
        fake = FakeApi(rows={(COPY, "verify"): none, (PROD, "reports_by_point"): [{"reports": 0}]})
        r = run(fake)
        self.assertTrue(r["passed"], r["failures"])
        self.assertIn("skipped: no report was issued by the restore point", r["verify_reference"])
        self.assertIn("skipped: no report", rd.markdown(r))


class Retries(unittest.TestCase):
    def test_a_transient_answer_is_retried(self):
        fake = FakeApi(flaky=[503, 429])
        self.assertTrue(run(fake)["passed"])

    def test_a_dropped_connection_is_retried(self):
        import urllib.error
        fake = FakeApi(flaky=[urllib.error.URLError("reset")])
        self.assertTrue(run(fake)["passed"])

    def test_retries_are_bounded(self):
        import urllib.error
        fake = FakeApi(flaky=[urllib.error.URLError("down")] * rd.RETRIES)
        with self.assertRaisesRegex(rd.DrillError, f"did not answer after {rd.RETRIES} attempts"):
            run(fake)
        self.assertEqual(len(fake.calls), rd.RETRIES)

    def test_a_refusal_is_not_retried(self):
        fake = FakeApi(flaky=[403])
        with self.assertRaisesRegex(rd.DrillError, "returned 403"):
            run(fake)
        self.assertEqual(len(fake.calls), 1)

    def test_a_retried_delete_that_already_went_through_counts(self):
        fake = FakeApi(delete_status=404)
        self.assertTrue(run(fake)["deleted"])


class Cli(unittest.TestCase):
    def test_missing_env_exits_2(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"SUPABASE_ACCESS_TOKEN": "", "SUPABASE_PROJECT_REF": ""}):
            self.assertEqual(rd.main(["--drill-ref", COPY, "--restore-point", POINT.isoformat()]), 2)


if __name__ == "__main__":
    unittest.main()
