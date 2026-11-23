"""latest_attempt.py: a re-run's reports replace the failed attempt's, per job, and nothing else is lost."""
import subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("latest_attempt.py")


def run(src, dest):
    return subprocess.run([sys.executable, str(SCRIPT), str(src), str(dest)], capture_output=True, text=True)


class LatestAttemptTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.src, self.dest = self.root / "attempts", self.root / "reports"

    def tearDown(self):
        self._tmp.cleanup()

    def put(self, artifact, name, text):
        d = self.src / artifact
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(text)

    def test_a_rerun_job_is_read_from_its_latest_attempt_only(self):
        self.put("reports-worker-attempt-1", "worker.xml", "failed")
        self.put("reports-worker-attempt-2", "worker.xml", "passed")
        self.assertEqual(run(self.src, self.dest).returncode, 0)
        self.assertEqual((self.dest / "worker" / "worker.xml").read_text(), "passed")
        self.assertEqual([p.name for p in self.dest.iterdir()], ["worker"])

    def test_attempts_compare_as_numbers_not_text(self):
        self.put("reports-e2e-attempt-2", "e2e.xml", "old")
        self.put("reports-e2e-attempt-10", "e2e.xml", "new")
        run(self.src, self.dest)
        self.assertEqual((self.dest / "e2e" / "e2e.xml").read_text(), "new")

    def test_jobs_that_were_not_rerun_keep_their_first_attempt(self):
        self.put("reports-database-attempt-1", "database.tap", "db")
        self.put("reports-web-attempt-1", "web.xml", "web")
        self.put("reports-worker-attempt-1", "worker.xml", "failed")
        self.put("reports-worker-attempt-2", "worker.xml", "passed")
        run(self.src, self.dest)
        self.assertEqual(sorted(p.name for p in self.dest.iterdir()), ["database", "web", "worker"])
        self.assertEqual((self.dest / "database" / "database.tap").read_text(), "db")
        self.assertEqual((self.dest / "worker" / "worker.xml").read_text(), "passed")

    def test_job_names_with_hyphens_and_unnumbered_artifacts(self):
        self.put("reports-web-unit-attempt-1", "a.xml", "a")
        self.put("reports-legacy", "b.xml", "legacy")
        self.put("reports-legacy-attempt-1", "b.xml", "numbered")
        self.put("not-a-report", "c.xml", "ignored")
        run(self.src, self.dest)
        self.assertEqual((self.dest / "web-unit" / "a.xml").read_text(), "a")
        self.assertEqual((self.dest / "legacy" / "b.xml").read_text(), "numbered")
        self.assertFalse((self.dest / "not-a-report").exists())

    def test_nothing_downloaded_leaves_an_empty_folder_and_does_not_fail(self):
        r = run(self.src, self.dest)
        self.assertEqual(r.returncode, 0)
        self.assertTrue(self.dest.is_dir() and not any(self.dest.iterdir()))

    def test_conformance_reads_the_chosen_files(self):
        """The result glob conformance uses ('reports/**/*.xml') finds the copied reports one level down."""
        self.put("reports-worker-attempt-2", "worker.xml", "passed")
        run(self.src, self.dest)
        self.assertEqual([p.name for p in self.dest.glob("**/*.xml")], ["worker.xml"])


if __name__ == "__main__":
    unittest.main()
