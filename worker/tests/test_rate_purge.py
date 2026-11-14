"""T-1103 units: the rate_purge job purges the RPC rate counters inside the Sentry cron check-in 'rate-counter-purge'
(docs/17) and reports how many it deleted; a failure reports the check-in as an error and the job retries."""
from typing import Any

import pytest

from nutrivo_worker import observability as obs
from nutrivo_worker.config import Settings
from nutrivo_worker.handlers import maintenance
from nutrivo_worker.jobs import KINDS, Job, JobContext, registry


class _Store:
    def __init__(self, fail=False):
        self.fail = fail
        self.refs: list[str] = []
        self.progress: dict[str, Any] = {}

    def purge_rate_counters(self, ref):
        if self.fail:
            raise RuntimeError("database said no")
        self.refs.append(ref)
        return {"deleted": 7}

    def heartbeat(self, job_id, progress):
        self.progress.update(progress or {})


@pytest.fixture
def checkins(monkeypatch):
    seen: list[tuple[str, str, Any]] = []
    monkeypatch.setattr(obs.crons, "capture_checkin",
                        lambda monitor_slug, status, monitor_config=None, check_in_id=None:
                        seen.append((monitor_slug, status, monitor_config)) or "ci-1")
    return seen


def _run(store):
    job = Job("job-1", "rate_purge", None, {}, 1)
    return maintenance.rate_purge(job, JobContext(job, store, Settings()), store)


def test_T1103_the_daily_purge_runs_inside_its_cron_check_in(checkins):
    store = _Store()
    assert _run(store) == {"deleted": 7}
    assert store.refs == ["job-1"] and store.progress == {"deleted": 7}
    assert [(c[0], c[1]) for c in checkins] == [("rate-counter-purge", "in_progress"), ("rate-counter-purge", "ok")]
    assert checkins[0][2]["schedule"] == {"type": "crontab", "value": "53 2 * * *"}   # the pg_cron schedule


def test_T1103_a_failed_purge_reports_the_check_in_as_an_error_and_raises_so_the_job_retries(checkins):
    with pytest.raises(RuntimeError):
        _run(_Store(fail=True))
    assert [(c[0], c[1]) for c in checkins] == [("rate-counter-purge", "in_progress"), ("rate-counter-purge", "error")]


def test_T1103_the_purge_kind_is_known_and_has_a_handler():
    assert "rate_purge" in KINDS
    assert registry.get("rate_purge") is not None
