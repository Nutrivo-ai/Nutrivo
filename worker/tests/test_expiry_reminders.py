"""T-803 units: the expiry_reminders job runs the producer inside the Sentry cron check-in 'expiry-reminders' and
reports its counts; a failure reports the check-in as an error and the job retries."""
from typing import Any

import pytest

from nutrivo_worker import observability as obs
from nutrivo_worker.config import Settings
from nutrivo_worker.handlers import expiry
from nutrivo_worker.jobs import KINDS, Job, JobContext, registry


class _Store:
    def __init__(self, answer=None, fail=False):
        self.answer, self.fail = answer or {"queued": 2, "already": 1}, fail
        self.refs: list[str] = []
        self.progress: dict[str, Any] = {}

    def queue_expiry_reminders(self, ref):
        if self.fail:
            raise RuntimeError("database said no")
        self.refs.append(ref)
        return self.answer

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
    job = Job("job-1", "expiry_reminders", None, {}, 1)
    return expiry.expiry_reminders(job, JobContext(job, store, Settings()), store)


def test_T803_H04_main_the_daily_job_queues_the_notices_inside_the_cron_check_in(checkins):
    store = _Store()
    assert _run(store) == {"queued": 2, "already": 1}
    assert store.refs == ["job-1"] and store.progress == {"queued": 2, "already": 1}
    assert [(c[0], c[1]) for c in checkins] == [("expiry-reminders", "in_progress"), ("expiry-reminders", "ok")]
    assert checkins[0][2]["schedule"] == {"type": "crontab", "value": "23 6 * * *"}   # the pg_cron schedule


def test_T803_a_failed_run_reports_the_check_in_as_an_error_and_raises_so_the_job_retries(checkins):
    with pytest.raises(RuntimeError):
        _run(_Store(fail=True))
    assert [(c[0], c[1]) for c in checkins] == [("expiry-reminders", "in_progress"), ("expiry-reminders", "error")]


def test_T803_the_kind_is_known_and_has_a_handler():
    assert "expiry_reminders" in KINDS
    assert registry.get("expiry_reminders") is not None
