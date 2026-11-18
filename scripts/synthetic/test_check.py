"""Tests for the synthetic check (T-1102): a fake HTTP layer, no network, no keys.
Run: python3 -m unittest discover -s scripts/synthetic -p 'test_*.py'"""
import json, unittest

import check

ENV = {"APP_BASE_URL": "https://app.example/", "SUPABASE_URL": "https://db.example", "SUPABASE_ANON_KEY": "anon-key-x"}
HTML = {"content-type": "text/html; charset=utf-8"}


class Fake:
    """Answers each path from a table; records every call. A list of answers is consumed one per call."""

    def __init__(self, **over):
        self.calls = []
        self.answers = {
            "/api/health": (200, {"x-request-id": "abcdef12"}, json.dumps({"status": "ok"}).encode()),
            "/sign-in": (200, HTML, b"<html><form action='/auth'></form></html>"),
            "verify": (200, {}, json.dumps({"status": "unknown"}).encode()),
        }
        self.answers.update(over)

    def __call__(self, url, headers=None):
        self.calls.append((url, dict(headers or {})))
        key = "verify" if "/functions/v1/verify/" in url else url.split(".example", 1)[1]
        answer = self.answers[key]
        if isinstance(answer, list):
            answer = answer.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def run(fake, env=ENV):
    lines = []
    code = check.run(get=fake, env=env.get, pause_s=0, out=lines.append)
    return code, lines


class SyntheticCheck(unittest.TestCase):
    def test_all_paths_pass(self):
        fake = Fake()
        code, lines = run(fake)
        self.assertEqual(code, 0, lines)
        self.assertEqual([l.split()[0] for l in lines], ["health", "sign-in", "verify"])
        self.assertEqual(fake.calls[0][0], "https://app.example/api/health")   # trailing slash dropped

    def test_verify_uses_a_well_formed_unknown_reference_and_the_anon_key(self):
        fake = Fake()
        run(fake)
        url, headers = fake.calls[2]
        ref = url.rsplit("/", 1)[1]
        self.assertTrue(url.startswith("https://db.example/functions/v1/verify/"))
        self.assertRegex(ref, r"^[A-Za-z0-9-]{20,64}$")      # checked before the database otherwise (docs/04)
        self.assertEqual(headers["apikey"], "anon-key-x")

    def test_verify_must_answer_exactly_unknown(self):
        extra = json.dumps({"status": "unknown", "issued_at": "x"}).encode()
        code, lines = run(Fake(verify=(200, {}, extra)))
        self.assertEqual(code, 1)
        self.assertIn("verify FAILED", lines[-1])

    def test_verify_database_down_fails(self):
        code, lines = run(Fake(verify=(503, {}, b"{}")))
        self.assertEqual(code, 1)
        self.assertIn("HTTP 503", lines[-1])

    def test_synthetic_reference_must_be_current_or_superseded(self):
        env = {**ENV, "SYNTHETIC_VERIFY_REF": "synthetic-report-ref-000001"}
        fake = Fake(verify=(200, {}, json.dumps({"status": "current", "issued_at": "2026-11-01"}).encode()))
        self.assertEqual(run(fake, env)[0], 0)
        self.assertTrue(fake.calls[2][0].endswith("/synthetic-report-ref-000001"))
        self.assertEqual(run(Fake(), env)[0], 1)              # unknown is a failure for the synthetic report

    def test_health_needs_ok_and_a_request_id(self):
        self.assertEqual(run(Fake(**{"/api/health": (200, {}, b'{"status":"ok"}')}))[0], 1)
        self.assertEqual(run(Fake(**{"/api/health": (200, {"x-request-id": "abcdef12"}, b'{"status":"down"}')}))[0], 1)
        self.assertEqual(run(Fake(**{"/api/health": (500, {}, b"")}))[0], 1)

    def test_sign_in_must_be_an_html_page(self):
        self.assertEqual(run(Fake(**{"/sign-in": (200, {"content-type": "application/json"}, b"{}")}))[0], 1)
        self.assertEqual(run(Fake(**{"/sign-in": (404, HTML, b"")}))[0], 1)

    def test_one_retry_absorbs_a_dropped_connection(self):
        fake = Fake(**{"/api/health": [ConnectionResetError("reset"), Fake().answers["/api/health"]]})
        code, lines = run(fake)
        self.assertEqual(code, 0, lines)
        self.assertEqual(len([c for c in fake.calls if c[0].endswith("/api/health")]), 2)

    def test_two_failures_in_a_row_fail(self):
        fake = Fake(**{"/api/health": [TimeoutError(), TimeoutError()]})
        code, lines = run(fake)
        self.assertEqual(code, 1)
        self.assertEqual(lines[0].split(":")[0], "health FAILED")
        self.assertIn("TimeoutError", lines[0])

    def test_missing_configuration_fails_without_calling_anything(self):
        fake = Fake()
        code, lines = run(fake, {"APP_BASE_URL": "https://app.example"})
        self.assertEqual((code, fake.calls), (1, []))
        self.assertIn("SUPABASE_URL", lines[0])

    def test_output_never_carries_a_key_a_reference_or_a_body(self):
        env = {**ENV, "SYNTHETIC_VERIFY_REF": "synthetic-report-ref-000001"}
        _, lines = run(Fake(verify=(200, {}, b'{"status":"current","issued_at":"secret-body"}')), env)
        text = "\n".join(lines)
        for s in ("anon-key-x", "synthetic-report-ref-000001", "secret-body", "db.example", "app.example"):
            self.assertNotIn(s, text)


if __name__ == "__main__":
    unittest.main()
