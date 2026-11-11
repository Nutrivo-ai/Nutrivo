"""T-901 · the diff_fanout handler (J03) without Postgres: payload checks, both job forms and the sweep's Sentry cron
check-in. tests/test_diff_fanout_pg.py runs the same paths on the local stack."""
from dataclasses import dataclass, field
from datetime import date

import pytest

from nutrivo_worker import observability as obs
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.handlers import diff_fanout
from nutrivo_worker.jobs import Job

DIFF = "80000000-0000-4000-8901-0000000000d1"
TODAY = date(2026, 11, 11)


@dataclass
class Ctx:
    beats: list = field(default_factory=list)

    def heartbeat(self, **progress):
        self.beats.append(progress)


class Store:
    def __init__(self, fanned=None, swept=None):
        self.fanned = fanned if fanned is not None else {"alerts": 3, "workspaces": [{}, {}]}
        self.swept = swept or {"in_force": 1, "notify_jobs": 2}
        self.calls = []

    def fan_out_rule_diff(self, rule_diff_id):
        self.calls.append(("fan_out", rule_diff_id))
        return self.fanned

    def run_alert_sweep(self, day):
        self.calls.append(("sweep", day))
        return self.swept


def job(payload, ws=None):
    return Job(id="j1", kind="diff_fanout", workspace_id=ws, payload=payload, attempts=1)


@pytest.fixture
def checkins(monkeypatch):
    seen = []
    monkeypatch.setattr(obs.crons, "capture_checkin", lambda **kw: seen.append(kw) or "ci-1")
    return seen


def test_J03_main_a_diff_job_fans_out_and_records_counts(checkins):
    store, ctx = Store(), Ctx()
    out = diff_fanout.run(job({"rule_diff_id": DIFF}), ctx, store, today=TODAY)
    assert store.calls == [("fan_out", DIFF)]
    assert out == {"outcome": "fanned_out", "rule_diff_id": DIFF, "alerts": 3, "workspaces": 2}
    assert ctx.beats[-1] == out
    assert checkins == []                       # only the daily sweep is a cron monitor


def test_J03_main_the_sweep_job_runs_inside_its_cron_checkin(checkins):
    store, ctx = Store(), Ctx()
    out = diff_fanout.run(job({"sweep": "2026-11-11"}), ctx, store, today=TODAY)
    assert store.calls == [("sweep", TODAY)]
    assert out == {"outcome": "swept", "day": "2026-11-11", "in_force": 1, "notify_jobs": 2}
    assert [c["status"] for c in checkins] == ["in_progress", "ok"]
    assert checkins[0]["monitor_slug"] == "alert-sweep" and checkins[0]["monitor_config"] == obs.ALERT_SWEEP_CONFIG


def test_T901_a_failed_sweep_reports_error_to_its_cron_monitor(checkins):
    class Boom(Store):
        def run_alert_sweep(self, day):
            raise RuntimeError("database went away")

    with pytest.raises(RuntimeError):
        diff_fanout.run(job({"sweep": "2026-11-10"}), Ctx(), Boom(), today=TODAY)
    assert [c["status"] for c in checkins] == ["in_progress", "error"]


def test_T901_an_editorial_diff_is_recorded_as_skipped(checkins):
    store = Store(fanned={"alerts": 0, "workspaces": [], "skipped": "editorial"})
    assert diff_fanout.run(job({"rule_diff_id": DIFF}), Ctx(), store)["outcome"] == "skipped_editorial"


@pytest.mark.parametrize("payload", [
    {}, {"rule_diff_id": DIFF, "sweep": "2026-11-11"}, {"rule_diff_id": "nope"}, {"sweep": "11/11/2026"},
    {"sweep": "2026-02-30"}, {"sweep": "2026-11-12"}, {"sweep": 20261111},
])
def test_T901_a_malformed_payload_fails_at_once(payload, checkins):
    store = Store()
    with pytest.raises(PermanentJobError):
        diff_fanout.run(job(payload), Ctx(), store, today=TODAY)
    assert store.calls == []


def test_T901_a_diff_job_naming_a_workspace_is_refused(checkins):
    with pytest.raises(PermanentJobError):
        diff_fanout.run(job({"rule_diff_id": DIFF}, ws="20000000-0000-4000-8901-00000000000a"), Ctx(), Store())


def test_T901_an_unknown_diff_fails_at_once(checkins):
    with pytest.raises(PermanentJobError, match="does not exist"):
        diff_fanout.run(job({"rule_diff_id": DIFF}), Ctx(), Missing())


class Missing(Store):
    def fan_out_rule_diff(self, rule_diff_id):
        return None
