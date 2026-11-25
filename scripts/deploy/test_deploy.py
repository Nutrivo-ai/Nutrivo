"""Tests for the staging and production deploy scripts (T-010), with curl and npx replaced by fakes on PATH: no keys,
no network, nothing deployed. Run: python3 -m unittest discover -s scripts/deploy -p 'test_*.py'"""
import json, os, stat, subprocess, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# A curl that answers Render's API from files in $FAKE_DIR and records every call (method and URL) in calls.log.
FAKE_CURL = r"""#!/usr/bin/env bash
method=GET; url=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2;;
    -d) data="$2"; shift 2;;
    -H) shift 2;;
    -*) shift;;
    *) url="$1"; shift;;
  esac
done
echo "$method $url $data" >> "$FAKE_DIR/calls.log"
case "$method $url" in
  "GET "*"/deploys?limit="*) cat "$FAKE_DIR/list.json";;
  "POST "*"/deploys") echo '{"id":"dep-new"}';;
  "GET "*"/deploys/dep-new") [ -f "$FAKE_DIR/poll-fails" ] && exit 22; cat "$FAKE_DIR/status.json";;
  "POST "*"/deploys/dep-new/cancel") echo '{}';;
  "POST "*"/rollback") [ -f "$FAKE_DIR/rollback-fails" ] && exit 22; echo '{}';;
  "GET "*"/v9/projects/"*) [ -f "$FAKE_DIR/project" ] || exit 22; printf '{"name":"%s"}' "$(cat "$FAKE_DIR/project")";;
  *) echo "unexpected $method $url" >&2; exit 22;;
esac
"""
# An npx that stands in for the pinned Vercel CLI: it records its arguments and prints a deployment URL.
FAKE_NPX = r"""#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/npx.log"
echo "$PWD" >> "$FAKE_DIR/npx.cwd"
case "$*" in *" deploy "*) echo "https://nutrivo-abc123.vercel.app";; *" rollback "*) [ -f "$FAKE_DIR/vercel-fails" ] && exit 1;; esac
exit 0
"""


def listing(*statuses):
    return json.dumps([{"deploy": {"id": f"dep-{i}", "status": s}} for i, s in enumerate(statuses)])


class Fake:
    def __init__(self):
        self.dir = tempfile.mkdtemp()
        self.bin = os.path.join(self.dir, "bin")
        os.mkdir(self.bin)
        for name, body in (("curl", FAKE_CURL), ("npx", FAKE_NPX)):
            path = os.path.join(self.bin, name)
            with open(path, "w") as fh:
                fh.write(body)
            os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)
        self.write("list.json", listing("live", "deactivated"))
        self.write("status.json", '{"status":"live"}')

    def write(self, name, text):
        with open(os.path.join(self.dir, name), "w") as fh:
            fh.write(text)

    def read(self, name):
        path = os.path.join(self.dir, name)
        return open(path).read() if os.path.exists(path) else ""

    def run(self, script, *args):
        env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "FAKE_DIR": self.dir,
               "RENDER_API_KEY": "rnd_test", "RENDER_WORKER_SERVICE_ID": "srv-1", "VERCEL_TOKEN": "vtok",
               "RENDER_API": "https://api.render.test/v1", "RENDER_PREV_FILE": os.path.join(self.dir, "prev"),
               "RENDER_POLLS": "3", "RENDER_POLL_SECONDS": "0",
               "VERCEL_PROJECT_ID": "prj_test", "VERCEL_ORG_ID": "team_test", "VERCEL_API": "https://api.vercel.test"}
        env.pop("STAGING_DOMAIN", None)
        return subprocess.run(["bash", os.path.join(HERE, script), *args], env=env, capture_output=True, text=True,
                              cwd=self.dir)


class RenderDeploy(unittest.TestCase):
    def test_records_the_deploy_that_was_live_before_deploying(self):
        f = Fake()
        r = f.run("render.sh", "srv-1", "abc123")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(f.read("prev").strip(), "dep-0")
        calls = f.read("calls.log").splitlines()
        self.assertTrue(calls[0].startswith("GET ") and "/deploys?limit=" in calls[0], calls)
        self.assertTrue(calls[1].startswith("POST ") and '"commitId":"abc123"' in calls[1], calls)

    def test_no_live_deploy_leaves_an_empty_record(self):
        f = Fake()
        f.write("list.json", listing("deactivated", "build_failed"))
        self.assertEqual(f.run("render.sh", "srv-1", "abc123").returncode, 0)
        self.assertEqual(f.read("prev").strip(), "")

    def test_a_failed_build_fails(self):
        f = Fake()
        f.write("status.json", '{"status":"build_failed"}')
        r = f.run("render.sh", "srv-1", "abc123")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("build_failed", r.stderr)

    def test_never_live_times_out_and_fails(self):
        f = Fake()
        f.write("status.json", '{"status":"build_in_progress"}')
        r = f.run("render.sh", "srv-1", "abc123")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("timed out", r.stderr)


    def test_a_failed_poll_cancels_the_started_deploy(self):
        """A deploy reported as failed must never go live afterwards with nothing rolling it back (docs/18)."""
        f = Fake()
        f.write("poll-fails", "")
        r = f.run("render.sh", "srv-1", "abc123")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("POST https://api.render.test/v1/services/srv-1/deploys/dep-new/cancel", f.read("calls.log"))

    def test_a_timeout_cancels_the_started_deploy(self):
        f = Fake()
        f.write("status.json", '{"status":"build_in_progress"}')
        self.assertNotEqual(f.run("render.sh", "srv-1", "abc123").returncode, 0)
        self.assertIn("/deploys/dep-new/cancel", f.read("calls.log"))

    def test_a_live_deploy_is_never_cancelled(self):
        f = Fake()
        self.assertEqual(f.run("render.sh", "srv-1", "abc123").returncode, 0)
        self.assertNotIn("/cancel", f.read("calls.log"))

    def test_a_failed_pre_deploy_command_fails_at_once(self):
        f = Fake()
        f.write("status.json", '{"status":"pre_deploy_failed"}')
        r = f.run("render.sh", "srv-1", "abc123")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("pre_deploy_failed", r.stderr)


class Rollback(unittest.TestCase):
    def test_nothing_named_rolls_back_nothing(self):
        f = Fake()
        r = f.run("rollback.sh", "staging")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(f.read("calls.log") + f.read("npx.log"), "")

    def test_worker_rolls_back_to_the_recorded_deploy(self):
        f = Fake()
        f.write("prev", "dep-7\n")
        r = f.run("rollback.sh", "staging", "worker")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('POST https://api.render.test/v1/services/srv-1/rollback {"deployId":"dep-7"}', f.read("calls.log"))

    def test_worker_without_a_recorded_deploy_fails_visibly(self):
        f = Fake()
        r = f.run("rollback.sh", "staging", "worker")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("worker rollback FAILED", r.stderr)
        self.assertNotIn("/rollback", f.read("calls.log"))

    def test_a_refused_worker_rollback_fails(self):
        f = Fake()
        f.write("prev", "dep-7\n")
        f.write("rollback-fails", "")
        r = f.run("rollback.sh", "staging", "worker")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("worker rollback FAILED", r.stderr)

    def test_staging_web_rolls_back_its_own_project(self):
        """Staging has its own Vercel project (#19): `vercel rollback` acts on nutrivo-staging's production slot."""
        f = Fake()
        f.write("project", "nutrivo-staging")
        r = f.run("rollback.sh", "staging", "web")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("vercel@64.1.0 rollback --yes", f.read("npx.log"))
        self.assertIn("/v9/projects/prj_test?teamId=team_test", f.read("calls.log"))

    def test_a_rollback_never_reaches_another_targets_project(self):
        for target, wrong in (("staging", "nutrivo"), ("prod", "nutrivo-staging"), ("staging", None)):
            with self.subTest(target=target, project=wrong):
                f = Fake()
                if wrong:
                    f.write("project", wrong)
                r = f.run("rollback.sh", target, "web")
                self.assertNotEqual(r.returncode, 0)
                self.assertEqual(f.read("npx.log"), "")  # the CLI never ran
                self.assertIn("refusing", r.stderr)

    def test_prod_web_uses_the_pinned_cli(self):
        f = Fake()
        f.write("project", "nutrivo")
        r = f.run("rollback.sh", "prod", "web")
        self.assertEqual(r.returncode, 0, r.stderr)
        log = f.read("npx.log")
        self.assertIn("vercel@64.1.0 rollback --yes", log)
        self.assertNotIn("@latest", log)
        self.assertEqual(set(f.read("npx.cwd").split()), {ROOT})

    def test_one_failed_part_fails_the_script_but_the_others_still_run(self):
        f = Fake()
        f.write("project", "nutrivo")
        f.write("vercel-fails", "")
        f.write("prev", "dep-7\n")
        r = f.run("rollback.sh", "prod", "web", "worker")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("web rollback FAILED", r.stderr)
        self.assertIn("/rollback", f.read("calls.log"))


class VercelDeploy(unittest.TestCase):
    def test_staging_is_a_production_deploy_of_its_own_project_and_records_its_url(self):
        f = Fake()
        f.write("project", "nutrivo-staging")
        url_file = os.path.join(ROOT, ".vercel-url")
        before = open(url_file).read() if os.path.exists(url_file) else None
        try:
            r = f.run("vercel.sh", "staging")
            self.assertEqual(r.returncode, 0, r.stderr)
            log = f.read("npx.log")
            self.assertIn("vercel@64.1.0 pull --yes --environment=production", log)
            self.assertIn("deploy --prebuilt --prod", log)
            self.assertIn("vercel@64.1.0 promote https://nutrivo-abc123.vercel.app --yes", log)
            self.assertNotIn("@latest", log)
            self.assertNotIn("alias", log)  # no STAGING_DOMAIN set
            self.assertEqual(open(url_file).read().strip(), "https://nutrivo-abc123.vercel.app")
            # The project's Root Directory is apps/web: the CLI runs from the repository root, never inside apps/web.
            self.assertEqual(set(f.read("npx.cwd").split()), {ROOT})
        finally:
            if before is None:
                os.path.exists(url_file) and os.remove(url_file)
            else:
                open(url_file, "w").write(before)

    def test_a_deploy_never_reaches_another_targets_project(self):
        """A wrong VERCEL_PROJECT_ID in Infisical must never send staging to production, or prod to staging."""
        for target, wrong in (("staging", "nutrivo"), ("prod", "nutrivo-staging"), ("staging", None)):
            with self.subTest(target=target, project=wrong):
                f = Fake()
                if wrong:
                    f.write("project", wrong)
                r = f.run("vercel.sh", target)
                self.assertNotEqual(r.returncode, 0)
                self.assertEqual(f.read("npx.log"), "")  # nothing pulled, built or deployed
                self.assertIn("refusing", r.stderr)

    def test_prod_promotes_the_new_deployment(self):
        """After an instant rollback Vercel stops moving the production domains to new deploys until one is promoted."""
        f = Fake()
        f.write("project", "nutrivo")
        url_file = os.path.join(ROOT, ".vercel-url")
        before = open(url_file).read() if os.path.exists(url_file) else None
        try:
            r = f.run("vercel.sh", "prod")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("vercel@64.1.0 promote https://nutrivo-abc123.vercel.app --yes", f.read("npx.log"))
        finally:
            if before is None:
                os.path.exists(url_file) and os.remove(url_file)
            else:
                open(url_file, "w").write(before)


class NoUnpinnedVercel(unittest.TestCase):
    def test_no_workflow_or_script_runs_vercel_at_latest(self):
        hits = []
        for base in ("scripts", ".github"):
            for d, _, files in os.walk(os.path.join(ROOT, base)):
                for name in files:
                    if name.endswith((".sh", ".yml", ".yaml")):
                        path = os.path.join(d, name)
                        if "vercel@latest" in open(path, errors="ignore").read():
                            hits.append(os.path.relpath(path, ROOT))
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
