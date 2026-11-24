"""make pr-open / pr-comment pass TITLE and BODY to pr.py unchanged, whatever characters they hold.
Run: uv run --no-project --with pyyaml python -m unittest discover -s scripts/protocol -p 'test_*.py'"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TITLES = [
    'Public site: "Join the pilot" while the form is live',
    "it's the pilot's page",
    "costs $HOME and $(shell id) and $$ and ${PATH}",
    "run `id` and $(id) here",
    "a \\ backslash; then & | < > * ? # ! ~ ending in \\",
    "all at once: \"x\" 'y' $z `w` \\",
]


class PrOpenTitle(unittest.TestCase):
    def setUp(self):
        fd, self.body = tempfile.mkstemp(suffix=" with space's.md")
        os.write(fd, b"Task: none\n\nbody with \"quotes\" and $vars\n")
        os.close(fd)
        self.addCleanup(os.remove, self.body)

    def make(self, *args, env=None):
        run = subprocess.run(["make", "-s", "--no-print-directory", "pr-open", f"PY={sys.executable}", *args],
                             cwd=ROOT, env={**os.environ, "PR_DRY_RUN": "1", **(env or {})},
                             capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout)

    def test_title_from_environment(self):
        for title in TITLES:
            with self.subTest(title=title):
                out = self.make(env={"TITLE": title, "BODY": self.body})
                self.assertEqual(out["title"], title)
                self.assertEqual(out["body"], Path(self.body).read_text(encoding="utf-8"))

    def test_title_on_make_command_line(self):
        for title in TITLES:
            with self.subTest(title=title):
                self.assertEqual(self.make(f"TITLE={title}", f"BODY={self.body}")["title"], title)


if __name__ == "__main__":
    unittest.main()
