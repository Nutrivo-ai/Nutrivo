"""The job runtime: a handler registry and the pgmq loop over app.jobs (docs/18, .claude/rules/worker.md).

A pgmq message carries only {"job_id"}; state lives in app.jobs. Processing one message:
1. Claim the job with a conditional update (queued, or running but stale). A job that already succeeded, failed or
   was cancelled is never run again: its duplicate message is deleted. A job held by a live worker keeps its message
   hidden for another lease.
2. Hide the message for the lease (stale_after_s), run the handler inside a Sentry transaction and a Langfuse trace.
3. Success: mark succeeded, then delete the message (acknowledge after commit). Failure: back off through the
   message's visibility timeout and retry, up to max_attempts; then mark failed with a safe last_error, archive the
   message and report to Sentry.
The reaper requeues jobs that have been running past the lease (a worker died mid-job).

Handlers must be idempotent (app.jobs.idempotency_key and unique constraints make repeated effects impossible), and a
handler running longer than the lease calls ctx.heartbeat() so the job is not taken for dead."""
from __future__ import annotations

import contextlib
import random
import signal
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import sentry_sdk

from . import observability as obs
from .config import Settings
from .errors import PermanentJobError, public_message
from .logs import get_logger, kv, log_context, workspace_hash

log = get_logger(__name__)

KINDS = ("extract", "check", "recheck", "bulk_recheck", "report", "export", "notify", "session_revoke", "diff_fanout",
         "billing_sync", "billing_reconcile")
Outcome = Literal["succeeded", "retry", "failed", "duplicate", "busy", "missing", "malformed"]


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    workspace_id: str | None
    payload: dict[str, Any]
    attempts: int

    @property
    def request_id(self) -> str | None:
        value = self.payload.get("request_id")
        return str(value) if value else None


@dataclass(frozen=True)
class Message:
    msg_id: int
    kind: str
    body: dict[str, Any]

    @property
    def job_id(self) -> str | None:
        value = self.body.get("job_id") if isinstance(self.body, dict) else None
        return str(value) if value else None


@dataclass(frozen=True)
class Claim:
    state: Literal["claimed", "missing", "busy", "succeeded", "failed", "cancelled"]
    job: Job | None = None


@dataclass(frozen=True)
class Reaped:
    job_id: str
    kind: str
    status: str
    attempts: int


class Store(Protocol):
    """The database operations the loop needs; PgStore implements them, tests may use a fake."""

    def read(self, kind: str, vt_s: int, qty: int) -> list[Message]: ...
    def claim(self, job_id: str, stale_after_s: int) -> Claim: ...
    def heartbeat(self, job_id: str, progress: dict[str, Any] | None) -> None: ...
    def succeed(self, job_id: str) -> None: ...
    def retry(self, job_id: str, error: str) -> None: ...
    def fail(self, job_id: str, error: str) -> None: ...
    def set_vt(self, kind: str, msg_id: int, vt_s: int) -> None: ...
    def delete(self, kind: str, msg_id: int) -> None: ...
    def archive(self, kind: str, msg_id: int) -> None: ...
    def reap(self, stale_after_s: int, max_attempts: int) -> list[Reaped]: ...


@dataclass
class JobContext:
    job: Job
    store: Store
    settings: Settings

    def heartbeat(self, **progress: Any) -> None:
        """Keep the lease and publish progress (Realtime subscribers see app.jobs.progress). Ids and counts only."""
        self.store.heartbeat(self.job.id, progress or None)


Handler = Callable[[Job, JobContext], None]


@dataclass(frozen=True)
class Registration:
    kind: str
    fn: Handler
    concurrency: int


@dataclass
class Registry:
    """One handler per job kind (the kinds app.jobs allows)."""

    _handlers: dict[str, Registration] = field(default_factory=dict)

    def register(self, kind: str, *, concurrency: int | None = None) -> Callable[[Handler], Handler]:
        if kind not in KINDS:
            raise ValueError(f"unknown job kind {kind!r}; app.jobs allows {', '.join(KINDS)}")
        if kind in self._handlers:
            raise ValueError(f"a handler for {kind!r} is already registered")

        def decorator(fn: Handler) -> Handler:
            self._handlers[kind] = Registration(kind, fn, concurrency or 0)
            return fn

        return decorator

    def get(self, kind: str) -> Registration | None:
        return self._handlers.get(kind)

    def kinds(self) -> list[str]:
        return sorted(self._handlers)


registry = Registry()
handler = registry.register


def backoff_s(attempt: int, settings: Settings, rand: Callable[[], float] = random.random) -> int:
    """Exponential backoff with jitter: base·2^(attempt-1), capped, scaled into [50%, 100%]."""
    raw = min(settings.backoff_cap_s, settings.backoff_base_s * 2 ** max(attempt - 1, 0))
    return max(1, int(raw * (0.5 + 0.5 * rand())))


def process_message(store: Store, reg: Registry, msg: Message, settings: Settings) -> Outcome:
    job_id = msg.job_id
    if job_id is None:
        log.warning("message without job_id archived", extra=kv(job_kind=msg.kind, msg_id=msg.msg_id))
        store.archive(msg.kind, msg.msg_id)
        return "malformed"
    with log_context(job_id=job_id, job_kind=msg.kind):
        claim = store.claim(job_id, settings.stale_after_s)
        if claim.state == "missing":
            log.warning("message for an unknown job archived", extra=kv(msg_id=msg.msg_id))
            store.archive(msg.kind, msg.msg_id)
            return "missing"
        if claim.state in ("succeeded", "failed", "cancelled"):
            store.delete(msg.kind, msg.msg_id)          # a duplicate delivery: the job is already terminal
            return "duplicate"
        if claim.state == "busy":
            store.set_vt(msg.kind, msg.msg_id, settings.stale_after_s)
            return "busy"
        assert claim.job is not None
        return _run(store, reg, msg, claim.job, settings)


def _run(store: Store, reg: Registry, msg: Message, job: Job, settings: Settings) -> Outcome:
    if job.attempts > settings.max_attempts:            # reclaimed after a crash with no attempts left
        return _fail(store, msg, job, PermanentJobError(f"attempts exhausted ({job.attempts - 1})"), report=True)
    registration = reg.get(job.kind)
    if registration is None:
        return _fail(store, msg, job, PermanentJobError(f"no handler for kind {job.kind}"), report=True)
    store.set_vt(msg.kind, msg.msg_id, settings.stale_after_s)
    started = time.monotonic()
    with log_context(request_id=job.request_id, workspace=workspace_hash(job.workspace_id)), \
            sentry_sdk.isolation_scope() as scope:
        for key, value in obs.job_tags(job).items():
            scope.set_tag(key, value)
        scope.set_tag("attempt", str(job.attempts))
        log.info("job started", extra=kv(attempt=job.attempts))
        try:
            with sentry_sdk.start_transaction(op="job", name=f"job:{job.kind}"), obs.job_observation(job):
                registration.fn(job, JobContext(job, store, settings))
        except PermanentJobError as exc:
            return _fail(store, msg, job, exc, report=True)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            if job.attempts >= settings.max_attempts:
                return _fail(store, msg, job, exc, report=False)
            delay = backoff_s(job.attempts, settings)
            store.retry(job.id, public_message(exc))
            store.set_vt(msg.kind, msg.msg_id, delay)
            log.warning("job failed, retrying", exc_info=exc,
                        extra=kv(attempt=job.attempts, retry_in_s=delay, error=public_message(exc)))
            return "retry"
        store.succeed(job.id)
        store.delete(msg.kind, msg.msg_id)              # acknowledge only after the state is committed
        log.info("job succeeded", extra=kv(attempt=job.attempts, duration_ms=int((time.monotonic() - started) * 1000)))
        return "succeeded"


def _fail(store: Store, msg: Message, job: Job, exc: BaseException, *, report: bool) -> Outcome:
    error = public_message(exc)
    store.fail(job.id, error)
    store.archive(msg.kind, msg.msg_id)
    if report:
        sentry_sdk.capture_exception(exc)
    log.error("job failed permanently", extra=kv(attempt=job.attempts, error=error))
    return "failed"


def reap(store: Store, settings: Settings) -> list[Reaped]:
    """Requeue jobs running past the lease (docs/18); a job with no attempts left fails instead."""
    with obs.reaper_checkin():
        reaped = store.reap(settings.stale_after_s, settings.max_attempts)
    for r in reaped:
        with log_context(job_id=r.job_id, job_kind=r.kind):
            log.warning("job reaped", extra=kv(status=r.status, attempt=r.attempts))
            if r.status == "failed" or r.attempts >= 2:   # requeued twice, or out of attempts: a person is told
                with sentry_sdk.isolation_scope() as scope:
                    scope.set_tag("job_id", r.job_id)
                    scope.set_tag("job_kind", r.kind)
                    sentry_sdk.capture_message(f"job {r.job_id} reaped after {r.attempts} attempts ({r.status})",
                                               level="warning")
    return reaped


def _close(store: Store | None) -> None:
    conn = getattr(store, "conn", None)
    if conn is not None:
        with contextlib.suppress(Exception):   # closing a broken connection may itself fail
            conn.close()


class Worker:
    """Polls every registered kind with bounded concurrency; heartbeats and reaps on timers; drains on SIGTERM."""

    def __init__(self, settings: Settings, reg: Registry, store_factory: Callable[[], Store]):
        self.settings, self.reg, self.store_factory = settings, reg, store_factory
        self.stop = threading.Event()
        self._local = threading.local()
        self._limits = {k: (reg.get(k).concurrency or settings.concurrency) for k in reg.kinds()}  # type: ignore[union-attr]
        self._inflight: dict[str, set[Future]] = {k: set() for k in self._limits}

    def _thread_store(self) -> Store:
        if getattr(self._local, "store", None) is None:
            self._local.store = self.store_factory()
        return self._local.store

    def _process(self, msg: Message) -> Outcome:
        try:
            return process_message(self._thread_store(), self.reg, msg, self.settings)
        except Exception as exc:          # the database went away mid-job: the message reappears after its vt
            _close(self._local.store)
            self._local.store = None
            sentry_sdk.capture_exception(exc)
            log.error("message processing aborted", exc_info=exc, extra=kv(job_kind=msg.kind, msg_id=msg.msg_id))
            raise

    def install_signal_handlers(self) -> None:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stop.set())

    def run(self, max_idle_loops: int | None = None) -> None:
        store: Store | None = None
        last_beat = last_reap = 0.0
        idle = 0
        retry_s = 1.0
        workers = max(1, sum(self._limits.values()))
        log.info("worker started", extra=kv(kinds=self.reg.kinds(), concurrency=self._limits))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="job") as pool:
            while not self.stop.is_set():
                try:
                    store = store or self.store_factory()
                    now = time.monotonic()
                    if now - last_beat >= self.settings.heartbeat_every_s:
                        obs.heartbeat()
                        last_beat = now
                    if now - last_reap >= self.settings.reap_every_s:
                        reap(store, self.settings)
                        last_reap = now
                    got = 0
                    for kind, limit in self._limits.items():
                        running = self._inflight[kind]
                        running.difference_update({f for f in running if f.done()})
                        free = limit - len(running)
                        if free <= 0:
                            continue
                        for msg in store.read(kind, self.settings.read_vt_s, free):
                            running.add(pool.submit(self._process, msg))
                            got += 1
                    retry_s = 1.0
                except Exception as exc:
                    _close(store)
                    store = None
                    sentry_sdk.capture_exception(exc)
                    log.error("worker loop error, reconnecting", exc_info=exc, extra=kv(retry_in_s=retry_s))
                    self.stop.wait(retry_s)
                    retry_s = min(retry_s * 2, 60.0)
                    continue
                if got == 0:
                    idle += 1
                    if max_idle_loops is not None and idle >= max_idle_loops and not any(self._inflight.values()):
                        break
                    self.stop.wait(self.settings.poll_interval_s)
                else:
                    idle = 0
                for running in self._inflight.values():
                    running.difference_update({f for f in running if f.done()})
            log.info("worker stopping: draining in-flight jobs")
        log.info("worker stopped")
