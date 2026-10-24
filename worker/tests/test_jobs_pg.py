"""The job loop on real Postgres and pgmq: jobs created by private.enqueue, as the RPCs create them.

Runs against the local Supabase database or NUTRIVO_TEST_DATABASE_URL (tests/pgtest.py); CI's `worker` job starts it
and fails these tests rather than skip them. They use the diff_fanout queue, which they purge, and delete only the app.jobs rows they created."""
import uuid

import psycopg
import pytest
from pgtest import DSN, connect_or_skip, skip_no_database

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.jobs import Registry, Worker, process_message, reap

KIND = "diff_fanout"
S = Settings(max_attempts=5, stale_after_s=900, poll_interval_s=0.05, heartbeat_every_s=3600, reap_every_s=3600)


@pytest.fixture
def store():
    conn = connect_or_skip(connect)
    if conn.execute("select to_regnamespace('pgmq') is not null as ok").fetchone()["ok"] is False:
        skip_no_database("pgmq is not installed in this database")
    conn.execute("select pgmq.purge_queue(%s)", (KIND,))
    yield PgStore(conn)
    conn.execute("delete from app.jobs where idempotency_key like 'test:t008:%'")
    conn.execute("select pgmq.purge_queue(%s)", (KIND,))
    conn.close()


def enqueue(store, payload=None):
    key = f"test:t008:{uuid.uuid4()}"
    row = store.conn.execute("select private.enqueue(%s, null, %s, %s::jsonb) as id",
                             (KIND, key, psycopg.types.json.Jsonb(payload or {}))).fetchone()
    return str(row["id"])


def job(store, job_id):
    return store.conn.execute("select status, attempts, last_error, progress from app.jobs where id = %s",
                              (job_id,)).fetchone()


def queued(store, table="q"):
    return store.conn.execute(f"select message->>'job_id' as job_id from pgmq.{table}_{KIND}").fetchall()


def read_one(store):
    [msg] = store.read(KIND, 30, 1)
    return msg


def test_enqueue_is_idempotent_and_the_message_holds_only_the_job_id(store):
    key = f"test:t008:{uuid.uuid4()}"
    ids = {store.conn.execute("select private.enqueue(%s, null, %s, '{}'::jsonb) as id", (KIND, key)).fetchone()["id"]
           for _ in range(2)}
    assert len(ids) == 1
    [msg] = store.read(KIND, 30, 5)
    assert msg.body == {"job_id": str(ids.pop())}


def test_success_commits_the_state_then_deletes_the_message(store):
    job_id = enqueue(store, {"request_id": "req-1"})
    reg = Registry()
    reg.register(KIND)(lambda j, ctx: ctx.heartbeat(items=2))
    assert process_message(store, reg, read_one(store), S) == "succeeded"
    assert job(store, job_id) == {"status": "succeeded", "attempts": 1, "last_error": None, "progress": {"items": 2}}
    assert queued(store) == [] and {"job_id": job_id} not in queued(store, "a")


def test_retries_then_fails_and_archives_after_five_attempts(store):
    job_id = enqueue(store)
    reg = Registry()

    @reg.register(KIND)
    def boom(j, ctx):
        raise RuntimeError("Ingredients: chicken")

    for attempt in range(1, 6):
        msg = read_one(store)
        outcome = process_message(store, reg, msg, S)
        assert outcome == ("failed" if attempt == 5 else "retry")
        if attempt < 5:
            assert job(store, job_id)["status"] == "queued"
            store.set_vt(KIND, msg.msg_id, 0)          # skip the backoff wait
    assert job(store, job_id) == {"status": "failed", "attempts": 5, "last_error": "RuntimeError", "progress": {}}
    assert queued(store) == [] and {"job_id": job_id} in queued(store, "a")


def test_a_duplicate_message_for_a_finished_job_is_dropped(store):
    job_id = enqueue(store)
    store.conn.execute("select pgmq.send(%s, %s::jsonb)", (KIND, f'{{"job_id": "{job_id}"}}'))
    runs = []
    reg = Registry()
    reg.register(KIND)(lambda j, ctx: runs.append(j.id))
    first, second = store.read(KIND, 30, 2)
    assert process_message(store, reg, first, S) == "succeeded"
    assert process_message(store, reg, second, S) == "duplicate"
    assert runs == [job_id] and queued(store) == []


def test_a_running_job_is_busy_until_stale_then_reclaimed(store):
    job_id = enqueue(store)
    msg = read_one(store)
    assert store.claim(job_id, 900).state == "claimed"
    assert store.claim(job_id, 900).state == "busy"
    store.conn.execute("update app.jobs set updated_at = now() - interval '16 minutes' where id = %s", (job_id,))
    reclaimed = store.claim(job_id, 900)
    assert reclaimed.state == "claimed" and reclaimed.job.attempts == 2
    assert store.claim("not-a-uuid", 900).state == "missing"
    store.delete(KIND, msg.msg_id)


def test_reaper_requeues_stale_jobs_with_a_fresh_message(store):
    stale, exhausted = enqueue(store), enqueue(store)
    store.conn.execute("select pgmq.purge_queue(%s)", (KIND,))
    store.conn.execute("update app.jobs set status = 'running', attempts = 1, updated_at = now() - interval '20 min'"
                       " where id = %s", (stale,))
    store.conn.execute("update app.jobs set status = 'running', attempts = 5, updated_at = now() - interval '20 min'"
                       " where id = %s", (exhausted,))
    reaped = {r.job_id: r.status for r in reap(store, S)}
    assert reaped == {stale: "queued", exhausted: "failed"}
    assert job(store, stale)["last_error"].startswith("Reaped") and queued(store) == [{"job_id": stale}]


def test_model_calls_rows_are_written(store):
    with store.conn.transaction(force_rollback=True):   # app.model_calls is insert-only: never leave test rows
        store.insert_model_call({"workspace_id": None, "purpose": "smoke", "provider": "bedrock",
                                 "model_id": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
                                 "prompt_version": "smoke.v1", "input_hash": "h" * 64, "output": {"answer": "OK"},
                                 "input_tokens": 230, "output_tokens": 9, "cost_eur": None, "latency_ms": 2944})
        row = store.conn.execute("select output, input_tokens from app.model_calls where input_hash = %s",
                                 ("h" * 64,)).fetchone()
    assert row == {"output": {"answer": "OK"}, "input_tokens": 230}


def test_the_worker_loop_runs_queued_jobs_end_to_end(store):
    ids = [enqueue(store) for _ in range(4)]
    reg = Registry()
    reg.register(KIND, concurrency=2)(lambda j, ctx: None)
    Worker(S, reg, lambda: PgStore.from_dsn(DSN)).run(max_idle_loops=5)
    assert [job(store, i)["status"] for i in ids] == ["succeeded"] * 4 and queued(store) == []
