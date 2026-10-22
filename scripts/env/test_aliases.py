"""config/secret-aliases.env parsing (aliases.py) and its use in with-aliases.sh. Dummy names and values only.
Run: python3 -m unittest discover -s scripts/env -p 'test_*.py'"""
import os, re, shutil, subprocess, tempfile, unittest
from pathlib import Path

from aliases import DEFAULT, load

HERE = Path(__file__).resolve().parent


class Load(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)

    def parse(self, text):
        f = self.dir / "secret-aliases.env"
        f.write_bytes(text.encode())
        return load(f)

    def test_pairs_with_comments_blank_lines_and_spaces(self):
        text = "# CANONICAL=EXISTING\n\nSENTRY_DSN_WEB=SENTRY_DSN\n  AWS_REGION = AWS_DEFAULT_REGION  # same value\n"
        self.assertEqual(self.parse(text), [("SENTRY_DSN_WEB", "SENTRY_DSN"), ("AWS_REGION", "AWS_DEFAULT_REGION")])

    def test_last_line_without_newline_counts(self):
        self.assertEqual(self.parse("A_ONE=B_ONE\nA_TWO=B_TWO"), [("A_ONE", "B_ONE"), ("A_TWO", "B_TWO")])

    def test_crlf_and_tabs(self):
        self.assertEqual(self.parse("A_ONE=B_ONE\r\n\tA_TWO\t=\tB_TWO\r\n"), [("A_ONE", "B_ONE"), ("A_TWO", "B_TWO")])

    def test_missing_file_has_no_aliases(self):
        self.assertEqual(load(self.dir / "absent.env"), [])

    def test_bad_lines_stop_with_the_line_number_and_never_echo_the_line(self):
        for bad in ["lower_case=B_ONE", "A_ONE=b-one", "A_ONE", "A_ONE=", "=B_ONE", "A_ONE=B_ONE=C_ONE",
                    "STRIPE_SECRET_KEY=sk_test_dummy123", "sk_live_dummyvalue=A_NAME"]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError) as e:
                    self.parse(f"# header\nGOOD_ONE=GOOD_TWO\n{bad}\n")
                self.assertIn("line 3", str(e.exception))
                for part in filter(None, re.split(r"[=\s]+", bad)):  # a pasted value may sit on either side
                    self.assertNotIn(part, str(e.exception))

    def test_the_repository_alias_file_parses(self):
        """Names only, so it runs without secrets: a bad line fails here before any job that holds secrets reads it."""
        self.assertIsInstance(load(DEFAULT), list)


class WithAliases(unittest.TestCase):
    """with-aliases.sh in a copy of the tree, so the repository's own alias file is never touched."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        (self.root / "scripts/env").mkdir(parents=True)
        (self.root / "config").mkdir()
        for name in ("aliases.py", "with-aliases.sh"):
            shutil.copy(HERE / name, self.root / "scripts/env" / name)

    def run_with(self, aliases, env):
        (self.root / "config/secret-aliases.env").write_text(aliases)
        base = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG")}
        return subprocess.run(["bash", str(self.root / "scripts/env/with-aliases.sh"), "bash", "-c",
                               'printf "%s|%s" "${CANON_ONE:-}" "${CANON_TWO:-}"'],
                              env={**base, **env}, capture_output=True, text=True)

    def test_canonical_name_takes_the_alias_value(self):
        r = self.run_with("CANON_ONE=OLD_ONE\nCANON_TWO=OLD_TWO", {"OLD_ONE": "dummy-1", "OLD_TWO": "dummy-2"})
        self.assertEqual((r.returncode, r.stdout), (0, "dummy-1|dummy-2"))

    def test_a_canonical_name_already_set_is_kept(self):
        r = self.run_with("CANON_ONE=OLD_ONE\n", {"CANON_ONE": "kept", "OLD_ONE": "dummy-1"})
        self.assertEqual((r.returncode, r.stdout), (0, "kept|"))

    def test_no_alias_file_lines_runs_the_command_unchanged(self):
        r = self.run_with("# names only\n", {"OLD_ONE": "dummy-1"})
        self.assertEqual((r.returncode, r.stdout), (0, "|"))

    def test_malformed_file_stops_before_the_command(self):
        r = self.run_with("CANON_ONE=OLD_ONE\ncanon_two=OLD_TWO\n", {"OLD_ONE": "dummy-1"})
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        self.assertIn("line 2", r.stderr)


if __name__ == "__main__":
    unittest.main()
