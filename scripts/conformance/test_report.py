"""report.py against small results: what passes, what counts as failing, and when the ratchet fails the run."""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

REPORT = Path(__file__).with_name("report.py")
SPEC = """workflows:
  A98:
    name: Example
    scope: BUILD
    milestone: M1
    tests: {A98.main: main path, A98.must.1: must hold, A98.fail.1: failure case}
  A99:
    name: Later
    scope: LATER
    milestone: M9
    tests: {A99.main: not required}
"""


def junit(*cases):
    body = "".join(f'<testcase classname="{c}" name="{n}">{extra}</testcase>' for c, n, extra in cases)
    return f'<?xml version="1.0"?><testsuites><testsuite name="s">{body}</testsuite></testsuites>'


class ReportTest(unittest.TestCase):
    def run_report(self, files, baseline, *args):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "spec.yaml").write_text(SPEC)
            (d / "baseline.json").write_text(json.dumps(baseline))
            (d / "reports").mkdir()
            for name, text in files.items():
                (d / "reports" / name).write_text(text)
            p = subprocess.run([sys.executable, str(REPORT), "--spec", str(d / "spec.yaml"), "--baseline",
                                str(d / "baseline.json"), "--out", str(d / "C.md"), "--results",
                                str(d / "reports/*.xml"), str(d / "reports/*.tap"), *args],
                               capture_output=True, text=True)
            return p, (d / "C.md").read_text() if (d / "C.md").exists() else "", json.loads(
                (d / "baseline.json").read_text())

    def test_ids_from_pytest_vitest_playwright_and_tap_pass(self):
        p, md, _ = self.run_report({
            "worker.xml": junit(("tests.test_x", "test_A98_main_works", "")),
            "web.xml": junit(("src/a.test.ts", "suite > [A98.must.1] holds", "")),
            "db.tap": "ok 1 - [A98.fail.1] refused\n",
        }, [], "--enforce")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("**3 of 3 required acceptance IDs pass", md)

    def test_a_skipped_test_fails_its_id_and_the_ratchet(self):
        p, md, _ = self.run_report({"worker.xml": junit(
            ("tests.test_x", "test_A98_main_works", '<skipped message="no local database: run make db-start"/>'))},
            ["A98.main"], "--enforce")
        self.assertEqual(p.returncode, 1)
        self.assertIn("## Regressions", md)
        self.assertIn("A98.main", p.stdout)

    def test_one_failing_result_fails_an_id_that_passes_elsewhere(self):
        p, _, _ = self.run_report({
            "web.xml": junit(("a", "[A98.main] unit", "")),
            "e2e.xml": junit(("b", "[A98.main] end to end", '<failure message="boom"/>'))}, ["A98.main"], "--enforce")
        self.assertEqual(p.returncode, 1)

    def test_skip_and_todo_in_tap_do_not_pass(self):
        p, _, _ = self.run_report({"db.tap": "ok 1 - [A98.main] x # SKIP no\nok 2 - [A98.must.1] y # TODO later\n"},
                                  ["A98.main", "A98.must.1"], "--enforce")
        self.assertEqual(p.returncode, 1)

    def test_a_baseline_id_with_no_result_at_all_is_a_regression(self):
        p, _, _ = self.run_report({}, ["A98.main"], "--enforce")
        self.assertEqual(p.returncode, 1)

    def test_without_enforce_a_regression_only_reports(self):
        p, md, _ = self.run_report({}, ["A98.main"])
        self.assertEqual(p.returncode, 0)
        self.assertIn("Regressions against the baseline: 1", md)

    def test_passing_ids_missing_from_the_baseline_are_listed(self):
        p, md, _ = self.run_report({"e2e.xml": junit(("b", "[A98.main] end to end", ""))}, [], "--enforce")
        self.assertEqual(p.returncode, 0)
        self.assertIn("## Passing, not yet in the baseline", md)
        self.assertIn("- `A98.main`", md)

    def test_update_adds_passing_ids_and_never_removes(self):
        p, _, baseline = self.run_report({"web.xml": junit(("a", "[A98.main] unit", ""))}, ["A98.must.1"],
                                         "--update-baseline")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(baseline, ["A98.main", "A98.must.1"])

    def test_update_is_refused_while_a_baseline_id_fails(self):
        p, _, baseline = self.run_report({"web.xml": junit(("a", "[A98.main] unit", '<failure message="x"/>'))},
                                         ["A98.main"], "--update-baseline")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("refusing to update the baseline", p.stderr)
        self.assertEqual(baseline, ["A98.main"])

    def test_ids_outside_build_scope_are_not_required(self):
        p, md, _ = self.run_report({"web.xml": junit(("a", "[A99.main] later", '<failure message="x"/>'))},
                                   ["A99.main"], "--enforce")
        self.assertEqual(p.returncode, 0)
        self.assertIn("0 of 3 required", md)


if __name__ == "__main__":
    unittest.main()
