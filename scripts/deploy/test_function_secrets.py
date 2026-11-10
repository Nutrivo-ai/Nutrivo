"""Tests for function-secrets.sh, with the Supabase CLI replaced by a fake on PATH: no keys, no network, nothing set.
Run: python3 -m unittest discover -s scripts/deploy -p 'test_*.py'"""
import os, stat, subprocess, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
# A supabase CLI that records its arguments, copies the --env-file it was given and the file's mode.
FAKE_SUPABASE = r"""#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/supabase.log"
while [ $# -gt 0 ]; do
  if [ "$1" = "--env-file" ]; then cp "$2" "$FAKE_DIR/env-file"; python3 -c 'import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' "$2" > "$FAKE_DIR/env-file.mode"; fi
  shift
done
"""
OK = {"SUPABASE_PROJECT_REF": "abcdefghijklmnopqrst", "STRIPE_WEBHOOK_SECRET": "whsec_test_not_a_real_secret_0001",
      "SENTRY_DSN_FUNCTIONS": "https://k3y@o1.ingest.de.sentry.io/42"}


class FunctionSecrets(unittest.TestCase):
    def run_script(self, *args, **env):
        self.dir = tempfile.mkdtemp()
        os.mkdir(os.path.join(self.dir, "bin"))
        fake = os.path.join(self.dir, "bin", "supabase")
        with open(fake, "w") as fh:
            fh.write(FAKE_SUPABASE)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        base = {k: v for k, v in os.environ.items() if k not in OK}
        full = {**base, "PATH": f"{self.dir}/bin:{os.environ['PATH']}", "FAKE_DIR": self.dir, "TMPDIR": self.dir, **env}
        return subprocess.run(["bash", os.path.join(HERE, "function-secrets.sh"), *args], env=full,
                              capture_output=True, text=True, cwd=self.dir)

    def read(self, name):
        path = os.path.join(self.dir, name)
        return open(path).read() if os.path.exists(path) else ""

    def test_sets_all_four_through_a_private_file_and_never_prints_a_value(self):
        r = self.run_script("staging", "abc123", **OK)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("secrets set --project-ref abcdefghijklmnopqrst --env-file", self.read("supabase.log"))
        self.assertEqual(self.read("env-file").splitlines(),
                         [f"STRIPE_WEBHOOK_SECRET={OK['STRIPE_WEBHOOK_SECRET']}",
                          f"SENTRY_DSN_FUNCTIONS={OK['SENTRY_DSN_FUNCTIONS']}", "NUTRIVO_ENV=staging",
                          "NUTRIVO_RELEASE=abc123"])
        self.assertEqual(self.read("env-file.mode").strip(), "600")
        for value in (OK["STRIPE_WEBHOOK_SECRET"], OK["SENTRY_DSN_FUNCTIONS"]):
            self.assertNotIn(value, r.stdout + r.stderr + self.read("supabase.log"))
        self.assertEqual([n for n in os.listdir(self.dir) if n.startswith("tmp")], [], "the env file is removed")

    def test_a_missing_secret_fails_by_name_and_sets_nothing(self):
        r = self.run_script("prod", "abc123", **{**OK, "STRIPE_WEBHOOK_SECRET": ""})
        self.assertEqual(r.returncode, 1)
        self.assertIn("missing STRIPE_WEBHOOK_SECRET in the prod Infisical project", r.stderr)
        self.assertEqual(self.read("supabase.log"), "")

    def test_a_dsn_outside_sentrys_eu_region_is_refused(self):
        for dsn in ("https://k@o1.ingest.us.sentry.io/42", "https://k@o1.ingest.sentry.io/42"):
            r = self.run_script("staging", "abc123", **{**OK, "SENTRY_DSN_FUNCTIONS": dsn})
            self.assertEqual(r.returncode, 1)
            self.assertIn("EU region", r.stderr)
            self.assertEqual(self.read("supabase.log"), "")

    def test_a_value_that_is_not_a_signing_secret_is_refused(self):
        r = self.run_script("staging", "abc123", **{**OK, "STRIPE_WEBHOOK_SECRET": "sk_test_wrong_key"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("whsec_", r.stderr)
        self.assertNotIn("sk_test_wrong_key", r.stderr)

    def test_unknown_environment_is_refused(self):
        self.assertEqual(self.run_script("dev", "abc123", **OK).returncode, 2)


if __name__ == "__main__":
    unittest.main()
