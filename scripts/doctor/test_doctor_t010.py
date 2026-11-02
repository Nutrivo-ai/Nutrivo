"""Tests for the doctor's T-010 changes: --strict turns a required check's skip into a failure, `app` is required on
staging, and Sentry and PostHog must be in the EU on staging and production (D-17). No keys, no network.
Run: python3 -m unittest discover -s scripts/doctor -p 'test_*.py'"""
import io, os, sys, unittest
from contextlib import redirect_stdout
from unittest import mock

import doctor

EU_SENTRY = {"SENTRY_DSN_WEB": "https://k1@o1.ingest.de.sentry.io/11", "SENTRY_DSN_WORKER": "https://k2@o1.ingest.de.sentry.io/12",
             "SENTRY_AUTH_TOKEN": "sntrys_test", "SENTRY_ORG": "nutrivo", "SENTRY_PROJECT_WEB": "web",
             "SENTRY_PROJECT_WORKER": "worker"}


def run_main(*args, checks):
    """doctor.main() over a replaced check table; returns (exit code, printed lines)."""
    out = io.StringIO()
    with mock.patch.object(doctor, "CHECKS", checks), mock.patch.object(sys, "argv", ["doctor.py", *args]), \
            redirect_stdout(out):
        with self_exit() as code:
            doctor.main()
    return code[0], out.getvalue().splitlines()


class self_exit:
    def __enter__(self):
        self.code = [None]
        return self.code

    def __exit__(self, kind, value, tb):
        if kind is SystemExit:
            self.code[0] = value.code
            return True
        return False


def skips(env):
    raise doctor.Skip("not deployed yet")


class Strict(unittest.TestCase):
    def test_a_required_skip_fails_only_with_strict(self):
        code, lines = run_main("--env", "staging", "--only", "vercel", checks={"vercel": skips})
        self.assertEqual(code, 0)
        self.assertTrue(any("· vercel" in line for line in lines), lines)
        code, lines = run_main("--env", "staging", "--only", "vercel", "--strict", checks={"vercel": skips})
        self.assertEqual(code, 1)
        self.assertTrue(any("✗ vercel" in line and "not deployed yet" in line for line in lines), lines)

    def test_strict_leaves_a_skip_of_a_check_that_is_not_required(self):
        code, lines = run_main("--env", "staging", "--only", "github", "--strict", checks={"github": skips})
        self.assertEqual(code, 0)
        self.assertTrue(any("· github" in line for line in lines), lines)

    def test_app_is_required_on_staging(self):
        self.assertIn("app", doctor.REQUIRED["staging"])


class EuOnly(unittest.TestCase):
    def test_a_sentry_dsn_outside_the_eu_fails_on_staging_and_prod_before_anything_is_sent(self):
        for env in ("staging", "prod"):
            with mock.patch.dict(os.environ, {**EU_SENTRY, "SENTRY_DSN_WORKER": "https://k2@o1.ingest.us.sentry.io/12"}), \
                    mock.patch.object(doctor, "_sentry_roundtrip") as rt:
                with self.assertRaises(AssertionError) as e:
                    doctor.c_sentry(env)
                self.assertIn("SENTRY_DSN_WORKER", str(e.exception))
                rt.assert_not_called()

    def test_eu_sentry_dsns_go_on_to_the_round_trip(self):
        with mock.patch.dict(os.environ, EU_SENTRY), \
                mock.patch.object(doctor, "_sentry_roundtrip", side_effect=lambda env, d, p: p) as rt:
            self.assertIn("round-trip ok", doctor.c_sentry("staging"))
            self.assertEqual(rt.call_count, 2)

    def test_dev_keeps_its_own_sentry_project(self):
        with mock.patch.dict(os.environ, {**EU_SENTRY, "SENTRY_DSN_WEB": "https://k1@o1.ingest.sentry.io/11"}), \
                mock.patch.object(doctor, "_sentry_roundtrip", side_effect=lambda env, d, p: p):
            self.assertIn("round-trip ok", doctor.c_sentry("dev"))

    def test_a_posthog_host_outside_the_eu_fails_before_capturing(self):
        with mock.patch.dict(os.environ, {"POSTHOG_KEY": "phc_test", "POSTHOG_HOST": "https://us.i.posthog.com"}), \
                mock.patch.object(doctor, "http") as http:
            with self.assertRaises(AssertionError) as e:
                doctor.c_posthog("staging")
            self.assertIn("EU", str(e.exception))
            http.assert_not_called()

    def test_the_eu_posthog_host_captures(self):
        with mock.patch.dict(os.environ, {"POSTHOG_KEY": "phc_test", "POSTHOG_HOST": "https://eu.i.posthog.com"}), \
                mock.patch.object(doctor, "http", return_value=(200, b"{}")) as http:
            self.assertEqual(doctor.c_posthog("prod"), "capture accepted")
            self.assertTrue(http.call_args.args[1].startswith("https://eu.i.posthog.com/capture/"))


if __name__ == "__main__":
    unittest.main()
