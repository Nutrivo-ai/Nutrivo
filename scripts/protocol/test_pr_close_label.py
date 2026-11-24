"""make pr-close and pr-label: a close always carries its reason; founder labels are refused.
Run: uv run --no-project --with pyyaml python -m unittest discover -s scripts/protocol -p 'test_*.py'"""
import json, os, subprocess, sys, tempfile, unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def make(target, *args, env=None):
    return subprocess.run(["make", "-s", "--no-print-directory", target, f"PY={sys.executable}", *args],
                          cwd=ROOT, env={**os.environ, "PR_DRY_RUN": "1", **(env or {})}, capture_output=True, text=True)


class PrClose(unittest.TestCase):
    def test_close_posts_the_reason_first(self):
        fd, body = tempfile.mkstemp(suffix=".md")
        os.write(fd, "Duplicate of #298, which merged the same fix.\n".encode())
        os.close(fd)
        self.addCleanup(os.remove, body)
        run = make("pr-close", "PR=296", f"BODY={body}")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), {"comment": "Duplicate of #298, which merged the same fix.\n", "close": "296",
                                                  "state_reason": "completed"})

    def test_a_duplicate_closes_as_not_planned(self):
        fd, body = tempfile.mkstemp(suffix=".md")
        os.write(fd, b"Duplicate of #298.\n")
        os.close(fd)
        self.addCleanup(os.remove, body)
        run = make("pr-close", "PR=296", f"BODY={body}", "REASON=not_planned")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)["state_reason"], "not_planned")

    def test_an_unknown_reason_or_an_empty_body_is_refused(self):
        fd, body = tempfile.mkstemp(suffix=".md")
        os.close(fd)
        self.addCleanup(os.remove, body)
        run = make("pr-close", "PR=296", f"BODY={body}")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("BODY is empty", run.stderr)
        Path(body).write_text("why\n", encoding="utf-8")
        run = make("pr-close", "PR=296", f"BODY={body}", "REASON=wontfix")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("REASON must be one of", run.stderr)

    def test_close_without_a_reason_is_refused(self):
        run = make("pr-close", "PR=296", env={"BODY": ""})
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("BODY=<file>", run.stderr)


class PrLabel(unittest.TestCase):
    def test_an_ordinary_label(self):
        run = make("pr-label", "PR=322", "LABEL=needs-human")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), {"label": "needs-human", "issue": "322", "lookup": "labels/needs-human"})

    def test_a_label_name_is_url_encoded_so_a_typo_never_creates_a_label(self):
        for name, path in (("  needs-human  ", "labels/needs-human"), ("Question", "labels/Question")):
            with self.subTest(name=name):
                run = make("pr-label", "PR=322", env={"LABEL": name})
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual(json.loads(run.stdout)["lookup"], path)
        for name in ("needs-human?x", "a#b"):  # never reaches GitHub: not on the list
            with self.subTest(name=name):
                self.assertNotEqual(make("pr-label", "PR=322", env={"LABEL": name}).returncode, 0)

    def test_founder_labels_are_refused(self):
        for name in ("human-approved", "scope-approved", "autopilot", "Human-Approved"):
            with self.subTest(name=name):
                run = make("pr-label", "PR=322", f"LABEL={name}")
                self.assertNotEqual(run.returncode, 0)
                self.assertIn("added by a founder", run.stderr)

    def test_labels_ci_applies_are_refused(self):
        for name in ("incident", "nightly", "task", " Incident ", "restore-drill", "fix-attempt-3", "status:ready",
                     "lane:db", "ms:M11", "quarantine", "a-label-added-next-year"):
            with self.subTest(name=name):
                run = make("pr-label", "PR=322", env={"LABEL": name})
                self.assertNotEqual(run.returncode, 0)
                self.assertIn("is not one pr-label adds", run.stderr)


class Live(unittest.TestCase):
    """The steps after the dry-run return, with GitHub stubbed: nothing leaves the process."""

    def setUp(self):
        sys.path.insert(0, str(ROOT / "scripts/protocol"))
        import pr
        self.pr = pr
        self.writes = []
        self.addCleanup(mock.patch.stopall)
        os.environ.pop("PR_DRY_RUN", None)
        mock.patch.object(pr, "write", side_effect=self.fake_write).start()
        self.said = []
        mock.patch.object(pr, "api_pages", side_effect=lambda path: [[{"body": b} for b in self.said]]).start()
        fd, self.body = tempfile.mkstemp(suffix=".md")
        os.write(fd, b"why\n")
        os.close(fd)
        self.addCleanup(os.remove, self.body)

    def fake_write(self, method, path, *fields, files=()):
        self.writes.append((method, path, fields))
        if path.endswith("/comments"):
            return {"html_url": "https://example.test/c"}
        if path.endswith("/labels"):
            return [{"name": "needs-human"}]
        return {"state": "closed"}

    def issue(self, **kw):
        return {"state": "open", "labels": [], "title": "Nightly load budgets failed 2026-11-20", **kw}

    def test_a_task_issue_is_never_closed(self):
        mock.patch.object(self.pr, "api", return_value=self.issue(labels=[{"name": "task"}])).start()
        with self.assertRaises(SystemExit) as e:
            self.pr.close("280", self.body, "completed")
        self.assertIn("task issue", str(e.exception))
        self.assertEqual(self.writes, [])

    def test_a_deploy_hold_or_release_incident_is_never_closed(self):
        for title in ("Staging deploy failed at 0163c66", "Production release v1.0 failed",
                      "[fixing] Staging deploy failed at abc1234", "re: production release blocked"):
            with self.subTest(title=title):
                mock.patch.object(self.pr, "api", return_value=self.issue(title=title, labels=[{"name": "incident"}])).start()
                with self.assertRaises(SystemExit) as e:
                    self.pr.close("320", self.body, "completed")
                self.assertIn("runbooks", str(e.exception))
        self.assertEqual(self.writes, [])

    def test_an_already_closed_issue_gets_no_comment(self):
        mock.patch.object(self.pr, "api", return_value=self.issue(state="closed")).start()
        self.assertEqual(self.pr.close("297", self.body, "completed"), 0)
        self.assertEqual(self.writes, [])

    def test_an_issue_closes_with_its_reason_after_the_comment(self):
        mock.patch.object(self.pr, "api", return_value=self.issue()).start()
        self.assertEqual(self.pr.close("299", self.body, "not_planned"), 0)
        self.assertEqual([(m, p) for m, p, _ in self.writes], [("POST", "issues/299/comments"), ("PATCH", "issues/299")])
        self.assertEqual(self.writes[1][2], ("state=closed", "state_reason=not_planned"))

    def test_a_retry_does_not_post_the_reason_twice(self):
        mock.patch.object(self.pr, "api", return_value=self.issue()).start()
        self.said = ["why"]
        self.assertEqual(self.pr.close("299", self.body, "completed"), 0)
        self.assertEqual([(m, p) for m, p, _ in self.writes], [("PATCH", "issues/299")])

    def test_a_pull_request_closes_without_a_state_reason(self):
        mock.patch.object(self.pr, "api", return_value=self.issue(pull_request={})).start()
        self.pr.close("296", self.body, "not_planned")
        self.assertEqual(self.writes[1][2], ("state=closed",))

    def test_a_label_must_exist_and_is_looked_up_encoded(self):
        api = mock.patch.object(self.pr, "api", return_value={"name": "needs-human"}).start()
        self.pr.label("322", "needs-human")
        api.assert_called_once_with("labels/needs-human")
        api.side_effect = RuntimeError("404 Not Found")
        self.writes.clear()
        with self.assertRaises(RuntimeError):
            self.pr.label("322", "wontfix")
        self.assertEqual(self.writes, [])


if __name__ == "__main__":
    unittest.main()
