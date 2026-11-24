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
        self.assertEqual(json.loads(run.stdout), {"comment": "Duplicate of #298, which merged the same fix.\n", "close": "296"})

    def test_close_without_a_reason_is_refused(self):
        run = make("pr-close", "PR=296", env={"BODY": ""})
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("BODY=<file>", run.stderr)


class PrLabel(unittest.TestCase):
    def test_an_ordinary_label(self):
        run = make("pr-label", "PR=322", "LABEL=needs-human")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout), {"label": "needs-human", "issue": "322"})

    def test_founder_labels_are_refused(self):
        for name in ("human-approved", "scope-approved", "autopilot", "Human-Approved"):
            with self.subTest(name=name):
                run = make("pr-label", "PR=322", f"LABEL={name}")
                self.assertNotEqual(run.returncode, 0)
                self.assertIn("only a founder adds it", run.stderr)


if __name__ == "__main__":
    unittest.main()
