"""T-1105: the reliability budgets of spec/nfr.yaml against the worker as it runs (docs/18).

Each test names its budget (test_nfr_<section>_<key>, scripts/load/test_budgets.py checks every budget has one). The
values come from the worker's own Settings, as `nutrivo work` builds them from an environment that sets none of them,
and from the job loop's decisions against the in-memory store.
"""
from pathlib import Path

import pytest
import yaml
from fakes import FakeStore

from nutrivo_worker.config import Settings
from nutrivo_worker.jobs import Registry, process_message, reap

NFR = yaml.safe_load((Path(__file__).resolve().parents[2] / "spec/nfr.yaml").read_text())["reliability"]
S = Settings.from_env({"NUTRIVO_ENV": "ci"})


def test_nfr_reliability_job_max_attempts():
    assert S.max_attempts == NFR["job_max_attempts"]
    store = FakeStore()
    msg = store.add("j1")

    def boom(job, ctx):
        raise RuntimeError("transient")

    reg = Registry()
    reg.register("notify")(boom)
    outcomes = [process_message(store, reg, msg, S) for _ in range(NFR["job_max_attempts"])]
    assert outcomes[-1] == "failed" and set(outcomes[:-1]) == {"retry"}
    assert store.jobs["j1"].attempts == NFR["job_max_attempts"]


@pytest.mark.xfail(strict=True, reason="#83 Q1: a claimed message stays hidden for the 15-minute lease, the budget says 300 s")
def test_nfr_reliability_job_visibility_timeout_s():
    store = FakeStore()
    msg = store.add("j1", status="running", attempts=1)          # held by a live worker: hidden for another lease
    process_message(store, Registry(), msg, S)
    assert store.vt[msg.msg_id] == NFR["job_visibility_timeout_s"]


def test_nfr_reliability_reaper_stuck_after_min():
    assert S.stale_after_s == NFR["reaper_stuck_after_min"] * 60
    store = FakeStore()
    seen = {}
    store.reap = lambda stale_after_s, max_attempts: seen.update(stale=stale_after_s) or []  # type: ignore[method-assign]
    reap(store, S)
    assert seen["stale"] == NFR["reaper_stuck_after_min"] * 60


def test_nfr_reliability_heartbeat_interval_s():
    assert S.heartbeat_every_s == NFR["heartbeat_interval_s"]
