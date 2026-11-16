"""Tests for the doctor's point-in-time recovery check (T-1101, gate G7). HTTP stubbed: no keys, no network.
Run: python3 -m unittest discover -s scripts/doctor -p 'test_*.py'"""
import json, os, unittest
from unittest import mock

import doctor

KEYS = {"SUPABASE_ACCESS_TOKEN": "sbp_test_token", "SUPABASE_PROJECT_REF": "prodref123"}


def backups(pitr=True, walg=True, status=200):
    body = {"region": "eu-central-1", "walg_enabled": walg, "pitr_enabled": pitr, "backups": [],
            "physical_backup_data": {}}
    calls = []

    def fake(method, url, headers=None, data=None, timeout=20):
        calls.append((method, url))
        return status, json.dumps(body).encode()
    return fake, calls


def run(fake):
    with mock.patch.dict(os.environ, KEYS), mock.patch.object(doctor, "http", fake):
        return doctor.c_pitr("prod")


class Pitr(unittest.TestCase):
    def test_required_for_prod_only(self):
        self.assertIn("pitr", doctor.REQUIRED["prod"])
        self.assertNotIn("pitr", doctor.REQUIRED["staging"])
        self.assertIs(doctor.CHECKS["pitr"], doctor.c_pitr)
        self.assertNotIn("pitr", doctor.WRITES)

    def test_on_passes_with_one_read(self):
        fake, calls = backups()
        self.assertIn("on", run(fake))
        self.assertEqual(calls, [("GET", "https://api.supabase.com/v1/projects/prodref123/database/backups")])

    def test_off_fails(self):
        with self.assertRaisesRegex(AssertionError, "point-in-time recovery is off"):
            run(backups(pitr=False)[0])

    def test_missing_flag_fails(self):
        def fake(*a, **k):
            return 200, b"{}"
        with self.assertRaisesRegex(AssertionError, "point-in-time recovery is off"):
            run(fake)

    def test_wal_archiving_off_fails(self):
        with self.assertRaisesRegex(AssertionError, "walg_enabled"):
            run(backups(walg=False)[0])

    def test_api_error_fails(self):
        with self.assertRaisesRegex(AssertionError, "returned 403"):
            run(backups(status=403)[0])

    def test_missing_keys_fail_by_name(self):
        with mock.patch.dict(os.environ, {k: "" for k in KEYS}):
            with self.assertRaisesRegex(AssertionError, "missing SUPABASE_ACCESS_TOKEN"):
                doctor.c_pitr("prod")


if __name__ == "__main__":
    unittest.main()
