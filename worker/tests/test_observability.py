"""Sentry and Langfuse wiring, observed through an in-process transport and an in-memory span exporter."""
import pytest
import sentry_sdk
from fakes import FakeStore, fake_jwt, fake_secret
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sentry_sdk.transport import Transport

from nutrivo_worker import observability as obs
from nutrivo_worker.config import Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.jobs import Registry, process_message


class Capture(Transport):
    def __init__(self, options=None):
        super().__init__(options)
        self.envelopes = []

    def capture_envelope(self, envelope):
        self.envelopes.append(envelope)

    def items(self, kind):
        return [i.payload.json for e in self.envelopes for i in e.items if i.type == kind]


@pytest.fixture
def sentry():
    transport = Capture()
    settings = Settings(env="staging", release="abc123", sentry_dsn="https://key@o1.ingest.de.sentry.io/1")
    assert obs.init_sentry(settings, transport=transport)
    yield transport
    sentry_sdk.init()          # back to a disabled client


def test_scrub_redacts_customer_text_and_keeps_ids():
    try:
        raise ValueError("Claim 'grain free' on panel sv for anna@example.com")
    except ValueError as exc:
        event = {"exception": {"values": [{"type": "ValueError", "module": "builtins", "value": str(exc),
                                           "stacktrace": {"frames": [{"function": "f", "vars": {"text": "x"}}]}}]},
                 "message": "job 0b6c1f3e-0000-4000-8000-000000000001 " + "tok" + "en=" + fake_secret(),
                 "extra": {"job_id": "j1", "label_text": "Ingredients"}, "request": {"data": "x"},
                 "release": "a" * 40, "breadcrumbs": {"values": [{"message": "mail bob@example.com", "data": {"q": 1}}]}}
        out = obs.scrub(event, {"exc_info": (type(exc), exc, exc.__traceback__)})
    value = out["exception"]["values"][0]
    assert value["value"] == obs.REDACTED and "vars" not in value["stacktrace"]["frames"][0]
    assert out["message"] == f"job 0b6c1f3e-0000-4000-8000-000000000001 {obs.REDACTED}"
    assert out["extra"] == {"job_id": "j1"} and "request" not in out and out["release"] == "a" * 40
    assert out["breadcrumbs"]["values"][0] == {"message": f"mail {obs.REDACTED}"}


def test_scrub_keeps_safe_error_messages():
    exc = PermanentJobError("payload has no artwork_version_id")
    event = {"exception": {"values": [{"type": "PermanentJobError", "module": "nutrivo_worker.errors",
                                       "value": str(exc)}]}}
    assert obs.scrub(event, {"exc_info": (type(exc), exc, None)})["exception"]["values"][0]["value"] == str(exc)


@pytest.mark.parametrize("text", ["Bearer " + fake_jwt(), "key " + fake_secret("sk-ant-api03-") + "x" * 8,
                                  "pw=" + "Z" * 48])
def test_scrub_text_removes_tokens(text):
    assert "eyJ" not in obs.scrub_text(text) and "sk-ant" not in obs.scrub_text(text)
    assert "Z" * 48 not in obs.scrub_text(text)


def test_a_failing_job_reaches_sentry_tagged_and_scrubbed(sentry):
    store = FakeStore()
    msg = store.add("j1", workspace_id="ws-1", payload={"request_id": "req-9", "ruleset_version": "eu-2026.1"})
    reg = Registry()

    @reg.register("notify")
    def boom(job, ctx):
        raise RuntimeError("Ingredients: chicken")

    assert process_message(store, reg, msg, Settings(max_attempts=5)) == "retry"
    sentry_sdk.flush()
    event = next(e for e in sentry.items("event") if e.get("exception"))
    assert event["exception"]["values"][-1]["value"] == obs.REDACTED
    assert {k: event["tags"][k] for k in ("job_kind", "job_id", "request_id", "ruleset_version", "attempt")} == \
        {"job_kind": "notify", "job_id": "j1", "request_id": "req-9", "ruleset_version": "eu-2026.1", "attempt": "1"}
    assert event["tags"]["workspace"] != "ws-1" and event["environment"] == "staging" and event["release"] == "abc123"
    assert "chicken" not in str(sentry.envelopes[0].serialize())
    assert any(t.get("transaction") == "job:notify" for t in sentry.items("transaction"))


def test_heartbeat_and_reaper_check_ins(sentry):
    obs.heartbeat()
    with obs.reaper_checkin():
        pass
    sentry_sdk.flush()
    checkins = sentry.items("check_in")
    assert [(c["monitor_slug"], c["status"]) for c in checkins] == \
        [("worker-heartbeat", "ok"), ("job-reaper", "in_progress"), ("job-reaper", "ok")]
    assert checkins[0]["monitor_config"]["schedule"] == {"type": "crontab", "value": "* * * * *"}
    assert checkins[1]["monitor_config"]["schedule"]["value"] == "*/5 * * * *"


def test_reaper_check_in_reports_errors(sentry):
    with pytest.raises(RuntimeError), obs.reaper_checkin():
        raise RuntimeError("db down")
    sentry_sdk.flush()
    assert [c["status"] for c in sentry.items("check_in")] == ["in_progress", "error"]


def test_source_watch_check_in_reports_errors_and_declares_no_schedule_yet(sentry):
    with obs.cron_checkin(obs.SOURCE_WATCH_MONITOR):
        pass
    with pytest.raises(RuntimeError), obs.cron_checkin(obs.SOURCE_WATCH_MONITOR):
        raise RuntimeError("cellar down")
    sentry_sdk.flush()
    checkins = sentry.items("check_in")
    assert [(c["monitor_slug"], c["status"]) for c in checkins] == \
        [("source-watch", "in_progress"), ("source-watch", "ok"), ("source-watch", "in_progress"),
         ("source-watch", "error")]
    assert not any("monitor_config" in c for c in checkins)   # no scheduler yet: no false missed check-ins


def test_sentry_is_off_without_a_dsn():
    assert obs.init_sentry(Settings()) is False


@pytest.fixture
def spans():
    exporter = InMemorySpanExporter()
    # The SDK keeps one set of resources per public key, so the test client gets its own key.
    obs.init_langfuse(Settings(env="dev", release="abc123", langfuse_public_key="pk-lf-test",
                               langfuse_secret_key="sk-lf-test"), span_exporter=exporter)
    yield exporter
    obs.init_langfuse(Settings())


def test_each_job_is_one_langfuse_trace_named_after_it(spans):
    store = FakeStore()
    msg = store.add("j7", payload={"request_id": "req-1"})
    reg = Registry()
    reg.register("notify")(lambda job, ctx: None)
    process_message(store, reg, msg, Settings())
    obs.langfuse().flush()
    [span] = [s for s in spans.get_finished_spans() if s.name == "job:notify:j7"]
    assert format(span.context.trace_id, "032x") == obs.job_trace_id("notify", "j7")
    assert span.attributes.get("langfuse.trace.name") == "job:notify:j7"
