"""Postgres access for the worker: app.jobs state and pgmq messages, over DATABASE_URL (service role or owner).
Every statement is its own short transaction; the reaper's update and requeue share one."""
from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .jobs import Claim, Job, Message, Reaped


def connect(dsn: str) -> psycopg.Connection:
    return psycopg.connect(dsn, autocommit=True, row_factory=dict_row, application_name="nutrivo-worker",
                           connect_timeout=10)


class PgStore:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    @classmethod
    def from_dsn(cls, dsn: str) -> PgStore:
        return cls(connect(dsn))

    def read(self, kind: str, vt_s: int, qty: int) -> list[Message]:
        rows = self.conn.execute("select msg_id, message from pgmq.read(%s, %s, %s)", (kind, vt_s, qty)).fetchall()
        return [Message(r["msg_id"], kind, r["message"] if isinstance(r["message"], dict) else {}) for r in rows]

    def claim(self, job_id: str, stale_after_s: int) -> Claim:
        try:
            row = self.conn.execute(
                """update app.jobs set status = 'running', attempts = attempts + 1, updated_at = now()
                    where id = %s and (status = 'queued'
                                       or (status = 'running' and updated_at < now() - make_interval(secs => %s)))
                returning id, kind, workspace_id, payload, attempts""", (job_id, stale_after_s)).fetchone()
        except psycopg.errors.InvalidTextRepresentation:
            return Claim("missing")              # not a uuid
        if row:
            return Claim("claimed", Job(str(row["id"]), row["kind"],
                                        str(row["workspace_id"]) if row["workspace_id"] else None,
                                        row["payload"] or {}, row["attempts"]))
        cur = self.conn.execute("select status from app.jobs where id = %s", (job_id,)).fetchone()
        if cur is None:
            return Claim("missing")
        return Claim("busy" if cur["status"] in ("running", "queued") else cur["status"])

    def heartbeat(self, job_id: str, progress: dict[str, Any] | None) -> None:
        self.conn.execute("update app.jobs set updated_at = now(), progress = progress || %s where id = %s"
                          " and status = 'running'", (Jsonb(progress or {}), job_id))

    def succeed(self, job_id: str) -> None:
        self.conn.execute("update app.jobs set status = 'succeeded', last_error = null, updated_at = now()"
                          " where id = %s", (job_id,))

    def retry(self, job_id: str, error: str) -> None:
        self.conn.execute("update app.jobs set status = 'queued', last_error = %s, updated_at = now() where id = %s",
                          (error, job_id))

    def fail(self, job_id: str, error: str) -> None:
        self.conn.execute("update app.jobs set status = 'failed', last_error = %s, updated_at = now() where id = %s",
                          (error, job_id))

    def set_vt(self, kind: str, msg_id: int, vt_s: int) -> None:
        self.conn.execute("select pgmq.set_vt(%s, %s, %s)", (kind, msg_id, vt_s))

    def delete(self, kind: str, msg_id: int) -> None:
        self.conn.execute("select pgmq.delete(%s, %s::bigint)", (kind, msg_id))

    def archive(self, kind: str, msg_id: int) -> None:
        self.conn.execute("select pgmq.archive(%s, %s::bigint)", (kind, msg_id))

    def reap(self, stale_after_s: int, max_attempts: int) -> list[Reaped]:
        with self.conn.transaction():
            rows = self.conn.execute(
                """with stale as (
                     select id from app.jobs
                      where status = 'running' and updated_at < now() - make_interval(secs => %(stale)s)
                      for update skip locked)
                   update app.jobs j
                      set status = case when j.attempts >= %(max)s then 'failed' else 'queued' end,
                          last_error = case when j.attempts >= %(max)s
                                            then 'Reaped: running past the lease with no attempts left'
                                            else 'Reaped: running past the lease, requeued' end,
                          updated_at = now()
                     from stale where j.id = stale.id
                   returning j.id, j.kind, j.status, j.attempts""",
                {"stale": stale_after_s, "max": max_attempts}).fetchall()
            for r in rows:
                if r["status"] == "queued":
                    self.conn.execute("select pgmq.send(%s, %s::jsonb)",
                                      (r["kind"], json.dumps({"job_id": str(r["id"])})))
        return [Reaped(str(r["id"]), r["kind"], r["status"], r["attempts"]) for r in rows]

    def insert_model_call(self, row: dict[str, Any]) -> None:
        self.conn.execute(
            """insert into app.model_calls (workspace_id, purpose, provider, model_id, prompt_version, input_hash,
                                            output, input_tokens, output_tokens, cost_eur, latency_ms)
               values (%(workspace_id)s, %(purpose)s, %(provider)s, %(model_id)s, %(prompt_version)s, %(input_hash)s,
                       %(output)s, %(input_tokens)s, %(output_tokens)s, %(cost_eur)s, %(latency_ms)s)""",
            {**row, "output": Jsonb(row.get("output"))})
