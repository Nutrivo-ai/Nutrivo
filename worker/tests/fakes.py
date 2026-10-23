"""In-memory stand-ins for the database and providers, so the job and model logic is tested without Postgres."""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any

from nutrivo_worker.jobs import Claim, Job, Message, Reaped
from nutrivo_worker.models import Raw

MARKER = "hunter2"


def fake_secret(prefix: str = "") -> str:
    """A placeholder secret assembled at runtime, so the repository's secret scan never sees a key-shaped literal."""
    return prefix + MARKER


def fake_jwt() -> str:
    return ".".join(["ey" + "J" + "a" * 20, "ey" + "J" + "b" * 20, "c" * 20])


@dataclass
class FakeJob:
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    status: str = "queued"
    attempts: int = 0
    last_error: str | None = None
    stale: bool = False
    workspace_id: str | None = None
    progress: dict[str, Any] = field(default_factory=dict)


class FakeStore:
    def __init__(self) -> None:
        self.jobs: dict[str, FakeJob] = {}
        self.queue: dict[int, Message] = {}
        self.vt: dict[int, int] = {}
        self.archived: list[int] = []
        self.deleted: list[int] = []
        self.model_calls: list[dict[str, Any]] = []
        self._ids = itertools.count(1)

    def add(self, job_id: str, kind: str = "notify", **kw: Any) -> Message:
        self.jobs[job_id] = FakeJob(kind, **kw)
        return self.send(kind, {"job_id": job_id})

    def send(self, kind: str, body: dict[str, Any]) -> Message:
        msg = Message(next(self._ids), kind, body)
        self.queue[msg.msg_id] = msg
        return msg

    def read(self, kind: str, vt_s: int, qty: int) -> list[Message]:
        out = [m for m in self.queue.values() if m.kind == kind and self.vt.get(m.msg_id, 0) == 0][:qty]
        for m in out:
            self.vt[m.msg_id] = vt_s
        return out

    def claim(self, job_id: str, stale_after_s: int) -> Claim:
        j = self.jobs.get(job_id)
        if j is None:
            return Claim("missing")
        if j.status == "queued" or (j.status == "running" and j.stale):
            j.status, j.attempts, j.stale = "running", j.attempts + 1, False
            return Claim("claimed", Job(job_id, j.kind, j.workspace_id, j.payload, j.attempts))
        return Claim("busy" if j.status == "running" else j.status)  # type: ignore[arg-type]

    def heartbeat(self, job_id: str, progress: dict[str, Any] | None) -> None:
        self.jobs[job_id].progress.update(progress or {})

    def succeed(self, job_id: str) -> None:
        self.jobs[job_id].status, self.jobs[job_id].last_error = "succeeded", None

    def retry(self, job_id: str, error: str) -> None:
        self.jobs[job_id].status, self.jobs[job_id].last_error = "queued", error

    def fail(self, job_id: str, error: str) -> None:
        self.jobs[job_id].status, self.jobs[job_id].last_error = "failed", error

    def set_vt(self, kind: str, msg_id: int, vt_s: int) -> None:
        self.vt[msg_id] = vt_s

    def delete(self, kind: str, msg_id: int) -> None:
        self.queue.pop(msg_id)
        self.deleted.append(msg_id)

    def archive(self, kind: str, msg_id: int) -> None:
        self.queue.pop(msg_id)
        self.archived.append(msg_id)

    def reap(self, stale_after_s: int, max_attempts: int) -> list[Reaped]:
        out = []
        for job_id, j in self.jobs.items():
            if j.status == "running" and j.stale:
                j.status = "failed" if j.attempts >= max_attempts else "queued"
                j.stale = False
                if j.status == "queued":
                    self.send(j.kind, {"job_id": job_id})
                out.append(Reaped(job_id, j.kind, j.status, j.attempts))
        return out

    def insert_model_call(self, row: dict[str, Any]) -> None:
        self.model_calls.append(row)


class FakeProvider:
    def __init__(self, name: str = "bedrock", text: str | None = '{"answer": "OK"}', stop_reason: str = "end_turn",
                 fail: int = 0, models: dict[str, str] | None = None):
        self.name, self.text, self.stop_reason, self.fail = name, text, stop_reason, fail
        self.models = models if models is not None else {"judgement": "eu.judge", "triage": "eu.triage",
                                                         "extraction": "eu.extract"}
        self.calls: list[dict[str, Any]] = []

    def model_for(self, model_class: str) -> str | None:
        return self.models.get(model_class)

    def complete(self, model_id: str, system: str, user: str, schema: dict, max_tokens: int) -> Raw:
        self.calls.append({"model_id": model_id, "system": system, "user": user, "schema": schema})
        if self.fail:
            self.fail -= 1
            raise ConnectionError("provider down")
        return Raw(self.name, model_id, self.text, self.stop_reason, 120, 8)
