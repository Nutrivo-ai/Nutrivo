"""make pr-close and pr-label: a close always carries its reason; founder labels are refused.
Run: uv run --no-project --with pyyaml python -m unittest discover -s scripts/protocol -p 'test_*.py'"""
import json, os, subprocess, sys, tempfile, unittest
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
        for name, path in (("needs-human?x", "labels/needs-human%3Fx"), ("a#b", "labels/a%23b"),
                           ("lane/db x", "labels/lane%2Fdb%20x"), ("  incident  ", "labels/incident")):
            with self.subTest(name=name):
                run = make("pr-label", "PR=322", env={"LABEL": name})
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual(json.loads(run.stdout)["lookup"], path)

    def test_founder_labels_are_refused(self):
        for name in ("human-approved", "scope-approved", "autopilot", "Human-Approved"):
            with self.subTest(name=name):
                run = make("pr-label", "PR=322", f"LABEL={name}")
                self.assertNotEqual(run.returncode, 0)
                self.assertIn("added by a founder", run.stderr)


if __name__ == "__main__":
    unittest.main()
