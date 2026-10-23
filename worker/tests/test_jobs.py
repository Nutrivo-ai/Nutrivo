"""The job loop's decisions, against an in-memory store (test_jobs_pg.py runs the same paths on Postgres)."""
import pytest
from fakes import FakeStore

from nutrivo_worker.config import Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.jobs import KINDS, Registry, Worker, backoff_s, process_message, reap

S = Settings(max_attempts=5, stale_after_s=900, backoff_base_s=10, backoff_cap_s=900)


def registry_with(fn, kind="notify"):
    reg = Registry()
    reg.register(kind)(fn)
    return reg


def test_registry_takes_one_handler_per_known_kind():
    reg = Registry()
    reg.register("notify")(lambda job, ctx: None)
    with pytest.raises(ValueError, match="already registered"):
        reg.register("notify")(lambda job, ctx: None)
    with pytest.raises(ValueError, match="unknown job kind"):
        reg.register("send_spam")
    assert reg.kinds() == ["notify"] and set(KINDS) >= set(reg.kinds())


def test_success_marks_succeeded_then_acknowledges():
    store, seen = FakeStore(), []
    msg = store.add("j1", payload={"request_id": "r1"})
    out = process_message(store, registry_with(lambda job, ctx: seen.append((job.id, job.request_id))), msg, S)
    assert out == "succeeded" and seen == [("j1", "r1")]
    assert store.jobs["j1"].status == "succeeded" and store.deleted == [msg.msg_id]


def test_a_job_that_already_succeeded_never_runs_again():
    store, runs = FakeStore(), []
    reg = registry_with(lambda job, ctx: runs.append(job.id))
    first = store.add("j1")
    duplicate = store.send("notify", {"job_id": "j1"})
    assert process_message(store, reg, first, S) == "succeeded"
    assert process_message(store, reg, duplicate, S) == "duplicate"
    assert runs == ["j1"] and duplicate.msg_id in store.deleted


def test_a_job_held_by_a_live_worker_is_left_alone():
    store = FakeStore()
    msg = store.add("j1", status="running", attempts=1)
    assert process_message(store, registry_with(lambda job, ctx: None), msg, S) == "busy"
    assert store.vt[msg.msg_id] == S.stale_after_s and store.jobs["j1"].status == "running"


def test_failure_retries_with_backoff_then_fails_after_five_attempts():
    store = FakeStore()
    msg = store.add("j1")

    def boom(job, ctx):
        raise RuntimeError("Ingredients: chicken")      # customer text must not reach last_error

    reg = registry_with(boom)
    for attempt in range(1, 5):
        assert process_message(store, reg, msg, S) == "retry"
        assert store.jobs["j1"].status == "queued" and store.jobs["j1"].attempts == attempt
        assert 1 <= store.vt[msg.msg_id] <= min(900, 10 * 2 ** (attempt - 1))
    assert process_message(store, reg, msg, S) == "failed"
    job = store.jobs["j1"]
    assert job.status == "failed" and job.attempts == 5 and job.last_error == "RuntimeError"
    assert msg.msg_id in store.archived and msg.msg_id not in store.queue


def test_permanent_errors_fail_at_once_with_their_safe_message():
    store = FakeStore()
    msg = store.add("j1")

    def bad(job, ctx):
        raise PermanentJobError("payload has no artwork_version_id")

    assert process_message(store, registry_with(bad), msg, S) == "failed"
    assert store.jobs["j1"].attempts == 1
    assert store.jobs["j1"].last_error == "PermanentJobError: payload has no artwork_version_id"


def test_malformed_and_unknown_messages_are_archived():
    store = FakeStore()
    reg = registry_with(lambda job, ctx: None)
    bad = store.send("notify", {"nope": 1})
    ghost = store.send("notify", {"job_id": "missing"})
    assert process_message(store, reg, bad, S) == "malformed"
    assert process_message(store, reg, ghost, S) == "missing"
    assert store.archived == [bad.msg_id, ghost.msg_id]


def test_a_stale_job_with_no_attempts_left_fails_without_running():
    store, runs = FakeStore(), []
    msg = store.add("j1", status="running", attempts=5, stale=True)
    assert process_message(store, registry_with(lambda job, ctx: runs.append(1)), msg, S) == "failed"
    assert runs == [] and store.jobs["j1"].last_error.startswith("PermanentJobError: attempts exhausted")


def test_heartbeat_publishes_progress():
    store = FakeStore()
    msg = store.add("j1")
    process_message(store, registry_with(lambda job, ctx: ctx.heartbeat(pages_done=3)), msg, S)
    assert store.jobs["j1"].progress == {"pages_done": 3}


def test_backoff_is_exponential_capped_and_jittered():
    assert [backoff_s(a, S, rand=lambda: 1.0) for a in (1, 2, 3, 7, 20)] == [10, 20, 40, 640, 900]
    assert backoff_s(3, S, rand=lambda: 0.0) == 20


def test_reaper_requeues_stale_jobs_and_fails_exhausted_ones():
    store = FakeStore()
    store.jobs.clear()
    from fakes import FakeJob
    store.jobs["a"] = FakeJob("notify", status="running", attempts=1, stale=True)
    store.jobs["b"] = FakeJob("notify", status="running", attempts=5, stale=True)
    store.jobs["c"] = FakeJob("notify", status="running", attempts=1)
    reaped = {r.job_id: r.status for r in reap(store, S)}
    assert reaped == {"a": "queued", "b": "failed"} and store.jobs["c"].status == "running"
    assert [m.body for m in store.queue.values()] == [{"job_id": "a"}]


def test_worker_loop_drains_the_queue_with_bounded_concurrency():
    store, done = FakeStore(), []
    reg = Registry()
    reg.register("notify", concurrency=2)(lambda job, ctx: done.append(job.id))
    for i in range(5):
        store.add(f"j{i}")
    Worker(Settings(poll_interval_s=0.01, heartbeat_every_s=3600, reap_every_s=3600), reg, lambda: store) \
        .run(max_idle_loops=3)
    assert sorted(done) == [f"j{i}" for i in range(5)] and not store.queue
