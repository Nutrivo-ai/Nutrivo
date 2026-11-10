"""Tests for the doctor's function-secrets check: the Edge Functions' secrets exist in the Supabase project (names
only) and the functions' Sentry DSN is in the EU. No keys, no network.
Run: python3 -m unittest discover -s scripts/doctor -p 'test_*.py'"""
import json, os, unittest
from unittest import mock

import doctor

ENV = {"SUPABASE_ACCESS_TOKEN": "sbp_test", "SUPABASE_PROJECT_REF": "abcdefghijklmnopqrst",
       "STRIPE_WEBHOOK_SECRET": "whsec_test_not_real", "SENTRY_DSN_FUNCTIONS": "https://k@o1.ingest.de.sentry.io/42"}
ALL = ["STRIPE_WEBHOOK_SECRET", "SENTRY_DSN_FUNCTIONS", "NUTRIVO_ENV", "NUTRIVO_RELEASE"]


def run(names, status=200, **env):
    calls = []

    def fake(method, url, headers=None, data=None, timeout=20):
        calls.append((method, url))
        return status, json.dumps([{"name": n, "value": "digest"} for n in names]).encode()

    with mock.patch.dict(os.environ, {**ENV, **env}), mock.patch.object(doctor, "http", fake):
        return doctor.c_function_secrets("staging"), calls


class FunctionSecrets(unittest.TestCase):
    def test_all_four_present_passes_and_reads_names_from_the_management_api(self):
        detail, calls = run(ALL + ["SUPABASE_URL"])
        self.assertEqual(detail, "4 function secrets set")
        self.assertEqual(calls, [("GET", "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/secrets")])

    def test_a_missing_one_fails_by_name(self):
        with self.assertRaisesRegex(AssertionError, "missing in the Supabase project: STRIPE_WEBHOOK_SECRET"):
            run([n for n in ALL if n != "STRIPE_WEBHOOK_SECRET"])

    def test_none_yet_is_a_skip_before_the_first_deploy(self):
        with self.assertRaises(doctor.Skip):
            run(["SUPABASE_URL"])

    def test_a_dsn_outside_the_eu_fails(self):
        with self.assertRaisesRegex(AssertionError, "EU region"):
            run(ALL, SENTRY_DSN_FUNCTIONS="https://k@o1.ingest.us.sentry.io/42")

    def test_a_webhook_secret_that_is_not_one_fails(self):
        with self.assertRaisesRegex(AssertionError, "signing secret"):
            run(ALL, STRIPE_WEBHOOK_SECRET="sk_test_wrong")

    def test_required_on_staging_and_prod_only(self):
        self.assertIn("function-secrets", doctor.REQUIRED["staging"])
        self.assertIn("function-secrets", doctor.REQUIRED["prod"])
        self.assertNotIn("function-secrets", doctor.REQUIRED["dev"])


if __name__ == "__main__":
    unittest.main()
