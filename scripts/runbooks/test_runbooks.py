"""T-1106: the runbooks name only workflows, scripts, make targets, Sentry monitors, doctor checks, labels, Render
services and RPCs that exist. Run: python3 -m unittest discover -s scripts/runbooks -p 'test_*.py'"""
import os, re, unittest

import check_runbooks as cr

REQUIRED = ["docs/runbooks/README.md", "docs/runbooks/incident-response.md", "docs/runbooks/rollback.md",
            "docs/runbooks/pitr-restore.md", "docs/runbooks/restore-drill.md", "docs/pilot-runbook.md"]


def read(rel):
    with open(os.path.join(cr.ROOT, rel), encoding="utf-8") as f:
        return f.read()


class RepoFacts(unittest.TestCase):
    """The checker reads the repository correctly, so a pass is not vacuous."""

    @classmethod
    def setUpClass(cls):
        cls.repo = cr.Repo()

    def test_reads_every_kind(self):
        r = self.repo
        self.assertIn("verify-fast", r.make_targets)
        self.assertIn("app.create_workspace", r.functions)
        self.assertIn("public.verify_reference", r.functions)
        self.assertIn("app.reports", r.functions)                       # tables count too
        self.assertTrue({"deploy-staging", "release-production", "restore-drill", "doctor", "synthetic"} <= r.workflows)
        self.assertTrue({"worker-heartbeat", "job-reaper", "stripe-reconcile", "synthetic-smoke-prod",
                         "restore-drill-prod"} <= r.monitors)
        self.assertTrue({"pitr", "postgres"} <= r.doctor_checks)
        self.assertTrue({"incident", "needs-human", "autopilot", "restore-drill"} <= r.labels)
        self.assertEqual({"nutrivo-worker-staging", "nutrivo-worker-prod"}, r.render_services)


class Checker(unittest.TestCase):
    """Each kind of broken reference is reported; a good one is not."""

    @classmethod
    def setUpClass(cls):
        cls.repo = cr.Repo()

    def errors(self, text):
        return cr.check_text("docs/runbooks/x.md", text, self.repo)[0]

    def test_good_references_pass(self):
        text = ("Run `scripts/deploy/rollback.sh` and `make doctor ENV=prod`; `app.create_workspace(name)`. "
                "Actions → `release-production`; monitors `worker-heartbeat` and `job-reaper`; doctor check `pitr`; "
                "labels `incident` and `needs-human`; Render service `nutrivo-worker-prod`; "
                "[drill](restore-drill.md); Actions → `<name>`; [web](https://example.com).")
        self.assertEqual([], self.errors(text))
        self.assertEqual(11, cr.check_text("docs/runbooks/x.md", text, self.repo)[1])

    def test_each_broken_kind_is_reported(self):
        cases = {
            "`scripts/deploy/rollforward.sh`": "path",
            "`make rollback-prod`": "Makefile target",
            "`app.restore_everything()`": "no migration",
            "Actions → `release-prod`": "no workflow",
            "monitor `worker-heartbeats`": "nothing checks in",
            "monitors `job-reaper` and `nightly-sweep`": "nothing checks in",
            "doctor check `backups`": "doctor",
            "label `sev1`": "label",
            "Render service `nutrivo-worker`": "render.yaml",
            "[gone](missing.md)": "does not exist",
        }
        for text, why in cases.items():
            with self.subTest(text=text):
                errs = self.errors(text)
                self.assertEqual(1, len(errs), errs)
                self.assertIn(why, errs[0])
                self.assertTrue(errs[0].startswith("docs/runbooks/x.md:1:"))


class Runbooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = cr.Repo()
        cls.errors, cls.counts = cr.check_all()

    def test_T1106_every_runbook_exists(self):
        """[T-1106] incidents, rollback, restore and pilot onboarding, and the index."""
        for rel in REQUIRED:
            with self.subTest(rel=rel):
                self.assertIn(rel, self.counts)
                self.assertGreaterEqual(self.counts[rel], 5, f"{rel} names almost nothing the checker can verify")

    def test_T1106_every_reference_resolves(self):
        """[T-1106] every workflow, script, make target, monitor, doctor check, label, service and RPC exists."""
        self.assertEqual([], self.errors, "\n" + "\n".join(self.errors))

    def test_T1106_index_lists_every_runbook(self):
        index = read("docs/runbooks/README.md")
        for rel in cr.runbook_files():
            if rel == "docs/runbooks/README.md":
                continue
            with self.subTest(rel=rel):
                self.assertIn(f"({os.path.relpath(rel, 'docs/runbooks')})", index)

    def test_T1106_every_sentry_monitor_has_a_runbook(self):
        """[T-1106] a new cron monitor fails here until a runbook says what to do when it alerts."""
        named = set()
        for rel in cr.runbook_files():
            for group in re.findall(r"\b[Mm]onitors? ((?:`[^`]+`(?:, | and | or )?)+)", read(rel)):
                named.update(cr._ticked_list(group))
        self.assertEqual(set(), self.repo.monitors - named)

    def test_T1106_runbooks_name_the_real_paths(self):
        """[T-1106] each runbook covers its own machinery."""
        expect = {
            "docs/runbooks/rollback.md": ["`scripts/deploy/rollback.sh`", "Actions → `deploy-staging`",
                                          "Actions → `release-production`", "`scripts/deploy/render.sh`"],
            "docs/runbooks/pitr-restore.md": ["doctor check `pitr`", "Actions → `doctor`",
                                              "Render service `nutrivo-worker-prod`", "`public.verify_reference`"],
            "docs/runbooks/incident-response.md": ["label `incident`", "Actions → `synthetic`", "Actions → `doctor`",
                                                   "(rollback.md)", "(pitr-restore.md)"],
            "docs/pilot-runbook.md": ["`app.create_workspace`", "`app.invite_member`", "`app.request_check`",
                                      "`public.coverage_snapshot`", "`public.verify_reference`"],
        }
        for rel, needles in expect.items():
            text = read(rel)
            for needle in needles:
                with self.subTest(rel=rel, needle=needle):
                    self.assertIn(needle, text)

    def test_T1106_open_points_name_the_issue(self):
        """[T-1106] a decision the runbooks leave open is marked with the issue that holds it."""
        for rel in cr.runbook_files():
            for m in re.finditer(r"\*\*Open( \(#\d+\))?:?\*\*", read(rel)):
                with self.subTest(rel=rel, at=m.start()):
                    self.assertIsNotNone(m.group(1), f"{rel}: **Open** without an issue number")


if __name__ == "__main__":
    unittest.main()
