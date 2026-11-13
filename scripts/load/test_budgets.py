"""T-1105: every budget in spec/nfr.yaml has a test that names it, and the budgets the repository itself holds are met.

Run by `make verify-fast` and CI's protocol job: python -m unittest discover -s scripts/load -p 'test_*.py'.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import budgets  # noqa: E402

SPEC = budgets.nfr()


class Coverage(unittest.TestCase):
    def test_every_budget_in_nfr_has_a_test_that_names_it(self):
        found = budgets.named_budgets()
        missing = [k for k in budgets.budget_keys() if not found[k]]
        self.assertEqual(missing, [], "a budget in spec/nfr.yaml with no [nfr:<budget>] test or test_nfr_<budget>")

    def test_every_measured_budget_is_named_by_the_load_suite(self):
        # The budgets measured under load live in apps/web/tests/load; the static ones here and in worker/tests.
        found = budgets.named_budgets()
        static = set(budgets.static_rows())
        for key in budgets.budget_keys():
            if key not in static:
                self.assertTrue(any(f.startswith("apps/web/tests/load/") for f in found[key]), key)

    def test_profiles_enforce_only_real_budgets(self):
        keys = set(budgets.budget_keys())
        for name, p in budgets.profiles().items():
            self.assertLessEqual(set(p["enforce"]), keys, name)
            for field in ("recipes", "rpc_calls", "board_loads", "verify_calls", "lcp_runs", "extractions", "checks", "concurrency"):
                self.assertGreater(p[field], 0, f"{name}.{field}")
        self.assertEqual(budgets.profiles()["staging"]["recipes"], 300, "the board budget is defined at 300 recipes")

    def test_a_new_budget_without_a_test_is_reported(self):
        spec = {**SPEC, "performance": {**SPEC["performance"], "brand_new_p95_ms": 1}}
        self.assertEqual(budgets.named_budgets(spec=spec)["performance.brand_new_p95_ms"], [])


class Static(unittest.TestCase):
    """The budgets the repository holds by itself, one test per budget."""

    def row(self, key):
        return budgets.static_rows()[key]

    def test_nfr_quality_visual_max_diff_pixel_ratio(self):
        self.assertEqual(self.row("quality.visual_max_diff_pixel_ratio").status, "met")

    def test_nfr_quality_axe_serious_or_critical(self):
        self.assertEqual(self.row("quality.axe_serious_or_critical").status, "met")

    def test_nfr_quality_required_acceptance_ratio(self):
        self.assertEqual(self.row("quality.required_acceptance_ratio").status, "met")

    def test_nfr_quality_quarantined_acceptance_tests(self):
        r = self.row("quality.quarantined_acceptance_tests")
        self.assertEqual(r.status, "met", r.detail)

    def test_nfr_security_high_or_critical_vulnerabilities(self):
        # Measured by the nightly audit (it needs the advisories database); here, that the audit is wired to fail.
        self.assertEqual(self.row("security.high_or_critical_vulnerabilities").status, "staging_only")

    def test_nfr_security_secrets_in_repository(self):
        self.assertEqual(self.row("security.secrets_in_repository").status, "met")

    def test_nfr_reliability_job_max_attempts(self):
        self.assertEqual(self.row("reliability.job_max_attempts").status, "met")

    @unittest.expectedFailure
    def test_nfr_reliability_job_visibility_timeout_s(self):
        # Open on #83 (Q1): the worker hides a claimed message for its 15-minute lease, the budget says 300 s. Strict:
        # when spec and worker agree this passes unexpectedly, which fails the run until this marker is removed.
        self.assertEqual(self.row("reliability.job_visibility_timeout_s").status, "met")

    def test_nfr_reliability_reaper_stuck_after_min(self):
        self.assertEqual(self.row("reliability.reaper_stuck_after_min").status, "met")

    def test_nfr_reliability_heartbeat_interval_s(self):
        self.assertEqual(self.row("reliability.heartbeat_interval_s").status, "met")


class Logic(unittest.TestCase):
    def test_settings_defaults_read_from_source(self):
        src = "class Settings(BaseModel):\n    a: int = Field(5, ge=1)\n    b: int = 60\n    c: str = 'x'\n    d: int = Field(15 * 60, ge=60)\n    e: int = Field(f())\n"
        self.assertEqual(budgets.worker_settings_defaults(src), {"a": 5, "b": 60, "c": "x", "d": 900})

    def test_a_reliability_budget_that_differs_is_exceeded(self):
        row = budgets.check_reliability("reliability.job_max_attempts", SPEC, {"max_attempts": 3})
        self.assertEqual((row.status, row.measured), ("exceeded", 3))

    def test_reaper_minutes_from_the_lease_seconds(self):
        row = budgets.check_reliability("reliability.reaper_stuck_after_min", SPEC, {"stale_after_s": 900})
        self.assertEqual((row.status, row.measured), ("met", 15))

    def _write(self, out: Path, key: str, **kw):
        out.mkdir(parents=True, exist_ok=True)
        d = {"budget": key, "limit": budgets.limit(key), "unit": "ms", "measured": 1, "n": 1, "status": "met",
             "profile": "ci", "enforced": False, **kw}
        (out / f"{key}.json").write_text(json.dumps(d))

    def test_report_fails_on_an_enforced_budget_exceeded_and_on_a_missing_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self._write(out, "performance.rpc_p95_ms", status="exceeded", measured=999, enforced=True)
            rows, failures = budgets.report("ci", out)
            self.assertIn("performance.rpc_p95_ms: exceeded", "\n".join(failures))
            # Nothing else measured: every other load budget is missing, which fails too.
            self.assertTrue(any(f.startswith("performance.verify_endpoint_p95_ms: missing") for f in failures))
            self.assertEqual(len(rows), len(budgets.budget_keys()))

    def test_report_never_counts_withheld_as_met_when_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            for key in budgets.budget_keys():
                if key not in budgets.static_rows():
                    self._write(out, key)
            self._write(out, "performance.rpc_p95_ms", status="withheld", measured=None)
            _, failures = budgets.report("ci", out)
            self.assertEqual([f.split(":")[0] for f in failures], ["performance.rpc_p95_ms"])

    def test_report_passes_when_everything_enforced_is_met(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            for key in budgets.budget_keys():
                if key not in budgets.static_rows():
                    self._write(out, key, status="withheld" if key.startswith("cost") else "met")
            rows, failures = budgets.report("ci", out)
            self.assertEqual(failures, [])
            md = budgets.markdown("ci", rows, failures)
            self.assertIn("`cost.model_cost_per_check_eur_p95`", md)
            self.assertIn("withheld", md)


if __name__ == "__main__":
    unittest.main()
