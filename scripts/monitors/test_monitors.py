"""Tests for the cron-monitor registry (T-1102): the repository itself, and small fake repositories that break it.
Run: uv run --no-project --with pyyaml python -m unittest discover -s scripts/monitors -p 'test_*.py'"""
import os, shutil, tempfile, textwrap, unittest

import monitors

OBS = textwrap.dedent('''\
    HEARTBEAT_MONITOR = "worker-heartbeat"
    HEARTBEAT_CONFIG = {"schedule": {"type": "crontab", "value": "* * * * *"}, "checkin_margin": 1}
    DUNNING_MONITOR = "dunning"
    DUNNING_CONFIG = {"schedule": {"type": "crontab", "value": "41 7 * * *"}, "checkin_margin": 60}
    ''')
MIGRATION = "do $$ begin perform cron.schedule('dunning', '41 7 * * *', 'select private.enqueue_dunning()'); end $$;\n"
WORKFLOW = textwrap.dedent('''\
    name: synthetic
    on:
      schedule: [{ cron: "*/15 * * * *" }]
    jobs:
      smoke:
        runs-on: ubuntu-24.04
        steps:
          - run: >
              npx --yes @sentry/cli@3.8.0 monitors run -e prod
              -s "*/15 * * * *" --check-in-margin 10 synthetic-smoke-prod -- python3 check.py
    ''')
REGISTRY = textwrap.dedent('''\
    monitors:
      - {slug: worker-heartbeat, source: worker, job: HEARTBEAT_MONITOR, schedule: "* * * * *", project: worker}
      - {slug: dunning, source: pg_cron, job: dunning, worker_config: DUNNING_CONFIG, schedule: "41 7 * * *", project: worker}
      - {slug: synthetic-smoke-prod, source: github, job: synthetic.yml, schedule: "*/15 * * * *", project: web}
    ''')
DOCS = "- `worker-heartbeat`\n- `dunning`\n- `synthetic-smoke-prod`\n"


class FakeRepo:
    def __init__(self):
        self.root = tempfile.mkdtemp()
        self.write(monitors.OBSERVABILITY, OBS)
        self.write(f"{monitors.MIGRATIONS}/20261101000000_dunning.sql", MIGRATION)
        self.write(f"{monitors.WORKFLOWS}/synthetic.yml", WORKFLOW)
        self.write(f"{monitors.WORKFLOWS}/ci.yml", "name: ci\non: { pull_request: {} }\njobs: {}\n")
        self.write(monitors.REGISTRY, REGISTRY)
        self.write(monitors.DOCS, DOCS)

    def write(self, rel, text):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)

    def edit(self, rel, old, new):
        with open(os.path.join(self.root, rel), encoding="utf-8") as fh:
            text = fh.read()
        assert old in text, old
        self.write(rel, text.replace(old, new))

    def problems(self):
        return monitors.problems(self.root)

    def close(self):
        shutil.rmtree(self.root)


class CronMonitors(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRepo()

    def tearDown(self):
        self.repo.close()

    def assertProblem(self, fragment):
        found = self.repo.problems()
        self.assertTrue(any(fragment in p for p in found), f"{fragment!r} not in {found}")

    def test_the_repository_has_a_monitor_for_every_scheduled_job(self):
        self.assertEqual(monitors.problems(), [])

    def test_the_repository_registry_covers_pg_cron_worker_and_github(self):
        self.assertTrue(monitors.pg_cron_jobs(monitors.ROOT))
        self.assertTrue(monitors.scheduled_workflows(monitors.ROOT))
        self.assertIn("synthetic.yml", monitors.scheduled_workflows(monitors.ROOT))

    def test_a_consistent_fake_repository_passes(self):
        self.assertEqual(self.repo.problems(), [])

    def test_a_pg_cron_job_without_a_monitor_fails(self):
        self.repo.write(f"{monitors.MIGRATIONS}/20261102000000_more.sql",
                        "select cron.schedule('nightly-purge', '5 1 * * *', 'select 1');\n")
        self.assertProblem("pg_cron job nightly-purge ('5 1 * * *') has no Sentry monitor")

    def test_an_unscheduled_pg_cron_job_needs_no_monitor(self):
        self.repo.write(f"{monitors.MIGRATIONS}/20261102000000_more.sql",
                        "select cron.schedule('nightly-purge', '5 1 * * *', 'select 1');\n")
        self.repo.write(f"{monitors.MIGRATIONS}/20261103000000_drop.sql", "select cron.unschedule('nightly-purge');\n")
        self.assertEqual(self.repo.problems(), [])

    def test_a_commented_out_pg_cron_job_is_not_a_job(self):
        self.repo.write(f"{monitors.MIGRATIONS}/20261102000000_more.sql",
                        "-- select cron.schedule('nightly-purge', '5 1 * * *', 'select 1');\n")
        self.assertEqual(self.repo.problems(), [])

    def test_a_scheduled_workflow_without_a_monitor_fails(self):
        self.repo.write(f"{monitors.WORKFLOWS}/weekly.yml",
                        "name: weekly\non:\n  schedule: [{ cron: '0 5 * * 1' }]\njobs: {}\n")
        self.assertProblem("scheduled workflow weekly.yml has no Sentry monitor")

    def test_a_worker_check_in_without_a_monitor_fails(self):
        self.repo.edit(monitors.OBSERVABILITY, 'DUNNING_MONITOR', 'SWEEP_MONITOR = "sweep"\nDUNNING_MONITOR')
        self.assertProblem('worker monitor SWEEP_MONITOR = "sweep" is not in')

    def test_a_workflow_that_never_checks_in_fails(self):
        self.repo.edit(f"{monitors.WORKFLOWS}/synthetic.yml", "synthetic-smoke-prod --", "other-slug --")
        self.assertProblem("synthetic.yml never runs `sentry-cli monitors run ... synthetic-smoke-prod`")

    def test_a_workflow_check_in_with_another_schedule_fails(self):
        self.repo.edit(f"{monitors.WORKFLOWS}/synthetic.yml", '-s "*/15 * * * *"', '-s "*/30 * * * *"')
        self.assertProblem("checks in with schedule ['*/30 * * * *']")

    def test_a_workflow_cron_that_differs_from_its_monitor_fails(self):
        self.repo.edit(f"{monitors.WORKFLOWS}/synthetic.yml", 'cron: "*/15 * * * *"', 'cron: "*/30 * * * *"')
        self.assertProblem("synthetic.yml is scheduled ['*/30 * * * *'], the registry says '*/15 * * * *'")

    def test_a_workflow_whose_cron_only_reminds_names_it_as_workflow_schedule(self):
        self.repo.edit(f"{monitors.WORKFLOWS}/synthetic.yml", 'cron: "*/15 * * * *"', 'cron: "0 8 2 * *"')
        self.repo.edit(monitors.REGISTRY, 'job: synthetic.yml, schedule: "*/15 * * * *"',
                       'job: synthetic.yml, schedule: "*/15 * * * *", workflow_schedule: "0 8 2 * *"')
        self.assertEqual(self.repo.problems(), [])

    def test_a_pg_cron_schedule_that_differs_from_the_registry_fails(self):
        self.repo.edit(f"{monitors.MIGRATIONS}/20261101000000_dunning.sql", "'41 7 * * *'", "'45 7 * * *'")
        self.assertProblem("pg_cron runs dunning at '45 7 * * *'")

    def test_a_worker_monitor_config_that_differs_from_pg_cron_fails(self):
        self.repo.edit(monitors.OBSERVABILITY, '"value": "41 7 * * *"', '"value": "40 7 * * *"')
        self.assertProblem("DUNNING_CONFIG expects '40 7 * * *'")

    def test_a_pg_cron_job_whose_handler_never_checks_in_fails(self):
        self.repo.edit(monitors.OBSERVABILITY, 'DUNNING_MONITOR = "dunning"', 'DUNNING_MONITOR = "dunning-2"')
        self.assertProblem("the worker never checks in to dunning")

    def test_a_slug_used_twice_fails(self):
        self.repo.edit(monitors.REGISTRY, "slug: dunning,", "slug: worker-heartbeat,")
        self.assertProblem("the slug is used twice")

    def test_a_monitor_docs_17_does_not_name_fails(self):
        self.repo.write(monitors.DOCS, "- `worker-heartbeat`\n- `dunning`\n")
        self.assertProblem("does not name the monitor `synthetic-smoke-prod`")


if __name__ == "__main__":
    unittest.main()
