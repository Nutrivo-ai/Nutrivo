"""Tests for the doctor's Langfuse round-trip (T-003), with the HTTP calls stubbed: no keys, no network.
Run: python3 -m unittest discover -s scripts/doctor -p 'test_*.py'"""
import json, os, unittest
from unittest import mock

import doctor

KEYS = {"LANGFUSE_PUBLIC_KEY": "pk-lf-test", "LANGFUSE_SECRET_KEY": "sk-lf-test",
        "LANGFUSE_BASE_URL": "https://cloud.langfuse.com/"}


class FakeLangfuse:
    """Records the OTLP span the doctor sends and answers the v2 observations read like Langfuse Cloud."""

    def __init__(self, ingest_status=200, ingest_body=b"{}", visible=True):
        self.ingest_status, self.ingest_body, self.visible = ingest_status, ingest_body, visible
        self.calls, self.span = [], None

    def __call__(self, method, url, headers=None, data=None, timeout=20):
        self.calls.append((method, url, headers))
        if method == "POST":
            self.span = data["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
            return self.ingest_status, self.ingest_body
        rows = [{"id": self.span["spanId"], "traceId": self.span["traceId"]}] if self.visible else []
        return 200, json.dumps({"data": rows, "meta": {}}).encode()


def run(fake):
    with mock.patch.dict(os.environ, KEYS), mock.patch.object(doctor, "http", fake), \
            mock.patch.object(doctor, "poll", lambda fn, seconds=90, every=5: fn()):
        return doctor.c_langfuse("dev")


class LangfuseRoundTrip(unittest.TestCase):
    def test_writes_otlp_and_reads_v2_observations(self):
        fake = FakeLangfuse()
        self.assertIn("round-trip ok", run(fake))
        (post, post_url, headers), (get, get_url, _) = fake.calls
        self.assertEqual((post, post_url), ("POST", "https://cloud.langfuse.com/api/public/otel/v1/traces"))
        self.assertEqual(get, "GET")
        self.assertTrue(get_url.startswith("https://cloud.langfuse.com/api/public/v2/observations?"))
        self.assertIn(f"traceId={fake.span['traceId']}", get_url)
        self.assertIn("fromStartTime=", get_url)
        self.assertIn("toStartTime=", get_url)
        self.assertEqual(headers["x-langfuse-ingestion-version"], "4")
        self.assertTrue(headers["Authorization"].startswith("Basic "))

    def test_span_is_valid_otlp_json(self):
        fake = FakeLangfuse()
        run(fake)
        span = fake.span
        self.assertRegex(span["traceId"], r"^[0-9a-f]{32}$")
        self.assertRegex(span["spanId"], r"^[0-9a-f]{16}$")
        self.assertLess(int(span["startTimeUnixNano"]), int(span["endTimeUnixNano"]))

    def test_never_uses_the_retired_v3_endpoints(self):
        fake = FakeLangfuse()
        run(fake)
        for _, url, _ in fake.calls:
            self.assertNotIn("/api/public/ingestion", url)
            self.assertNotIn("/api/public/traces", url)

    def test_rejected_span_fails(self):
        body = json.dumps({"partialSuccess": {"rejectedSpans": "1", "errorMessage": "bad"}}).encode()
        with self.assertRaisesRegex(AssertionError, "rejected"):
            run(FakeLangfuse(ingest_body=body))

    def test_ingestion_error_fails(self):
        with self.assertRaisesRegex(AssertionError, "returned 401"):
            run(FakeLangfuse(ingest_status=401))

    def test_span_not_readable_fails(self):
        with self.assertRaisesRegex(AssertionError, "not readable"):
            run(FakeLangfuse(visible=False))

    def test_missing_keys_fail_by_name(self):
        with mock.patch.dict(os.environ, {k: "" for k in KEYS}):
            with self.assertRaisesRegex(AssertionError, "missing LANGFUSE_PUBLIC_KEY"):
                doctor.c_langfuse("dev")


if __name__ == "__main__":
    unittest.main()
