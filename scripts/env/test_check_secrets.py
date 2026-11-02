"""check-secrets.py (T-010): an optional name is never reported missing, even with --all; a name a later task creates
is 'later' without --all and missing with it. Names only, no Infisical: the environment is emptied for the run.
Run: python3 -m unittest discover -s scripts/env -p 'test_*.py'"""
import os, shutil, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def run(*args):
    try:
        import yaml  # noqa: F401
        cmd = [sys.executable]
    except ImportError:          # the script needs PyYAML; CI's plain python3 may not have it
        cmd = [shutil.which("uv") or "uv", "run", "-q", "--no-project", "--with", "pyyaml", "python"]
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/tmp")}
    return subprocess.run([*cmd, os.path.join(HERE, "check-secrets.py"), *args], env=env, capture_output=True,
                          text=True, cwd=HERE)


class CheckSecrets(unittest.TestCase):
    def test_optional_names_are_never_missing_even_with_all(self):
        r = run("--env", "staging", "--all")
        self.assertNotIn("STAGING_DOMAIN", r.stdout)
        self.assertIn("MISSING APP_BASE_URL", r.stdout)       # from T-010, required with --all

    def test_without_all_a_later_task_name_is_later_not_missing(self):
        r = run("--env", "staging")
        self.assertIn("later   APP_BASE_URL", r.stdout)
        self.assertNotIn("MISSING APP_BASE_URL", r.stdout)
        self.assertNotIn("STAGING_DOMAIN", r.stdout)


if __name__ == "__main__":
    unittest.main()
