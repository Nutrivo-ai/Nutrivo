"""Sentry (errors, traces, cron check-ins) and Langfuse (one trace per job) for the worker (docs/17).

Sentry never receives customer text: `send_default_pii` is off, local variables are not captured, and `scrub`
redacts the message of every exception that is not a SafeError, plus emails and token-like strings anywhere.
Langfuse is reached only through its current Python SDK, which exports OpenTelemetry spans to
/api/public/otel/v1/traces; nothing here calls the retired v3 ingestion or trace endpoints."""
from __future__ import annotations

import contextlib
import re
from collections.abc import Iterator
from typing import Any

import sentry_sdk
from sentry_sdk import crons

from .config import Settings
from .errors import SafeError
from .logs import get_logger, workspace_hash

log = get_logger(__name__)

HEARTBEAT_MONITOR = "worker-heartbeat"
REAPER_MONITOR = "job-reaper"
HEARTBEAT_CONFIG = {"schedule": {"type": "crontab", "value": "* * * * *"}, "checkin_margin": 1, "max_runtime": 1,
                    "failure_issue_threshold": 5, "timezone": "UTC"}   # docs/18: a person is told after 5 minutes
REAPER_CONFIG = {"schedule": {"type": "crontab", "value": "*/5 * * * *"}, "checkin_margin": 5, "max_runtime": 5,
                 "timezone": "UTC"}

REDACTED = "[redacted]"
_PATTERNS = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),                # emails
    re.compile(r"(?i)\b(bearer|basic|token|apikey|api_key|secret|password)\b[\s:=]+\S+"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),  # JWTs
    re.compile(r"\b(sk|pk|rk|whsec|sk-ant|sk-lf|pk-lf)[-_][A-Za-z0-9_-]{8,}\b"),    # provider keys
    re.compile(r"\b[A-Za-z0-9_-]{40,}={0,2}"),                                    # long opaque tokens (not UUIDs)
]
_UNSCRUBBED = {"release", "environment", "event_id", "timestamp", "start_timestamp", "platform", "sdk", "contexts"}
_SAFE_EXTRA = {"job_id", "job_kind", "attempt", "workspace", "request_id", "ruleset_version", "reason"}


def scrub_text(value: str) -> str:
    for pattern in _PATTERNS:
        value = pattern.sub(REDACTED, value)
    return value


def _scrub(obj: Any) -> Any:
    if isinstance(obj, str):
        return scrub_text(obj)
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    return obj


def _exception_chain(exc: BaseException | None) -> list[BaseException]:
    seen: list[BaseException] = []
    while exc is not None and exc not in seen:
        seen.append(exc)
        exc = exc.__cause__ or exc.__context__
    return seen


def scrub(event: dict[str, Any], hint: dict[str, Any] | None) -> dict[str, Any]:
    """Sentry before_send: ids and types survive; anything that could be customer text does not."""
    exc_info = (hint or {}).get("exc_info")
    safe_types = {(type(e).__module__, type(e).__name__)
                  for e in _exception_chain(exc_info[1] if exc_info else None) if isinstance(e, SafeError)}
    for value in (event.get("exception") or {}).get("values") or []:
        if (value.get("module"), value.get("type")) not in safe_types:
            value["value"] = REDACTED
        for frame in (value.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    for key in ("request", "user"):
        event.pop(key, None)
    event["extra"] = {k: v for k, v in (event.get("extra") or {}).items() if k in _SAFE_EXTRA}
    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict):
        for crumb in crumbs.get("values") or []:
            crumb.pop("data", None)
    return {k: (v if k in _UNSCRUBBED else _scrub(v)) for k, v in event.items()}


def init_sentry(settings: Settings, **overrides: Any) -> bool:
    if not settings.sentry_dsn:
        log.info("sentry disabled: SENTRY_DSN_WORKER not set")
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn.get_secret_value(),
        environment=settings.env,
        release=settings.release,
        traces_sample_rate=settings.traces_sample_rate,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        before_send=scrub,
        before_send_transaction=scrub,
        **overrides,
    )
    return True


def job_tags(job: Any) -> dict[str, str]:
    tags = {"job_kind": job.kind, "job_id": str(job.id), "workspace": workspace_hash(job.workspace_id),
            "request_id": job.request_id, "ruleset_version": job.payload.get("ruleset_version")}
    return {k: str(v) for k, v in tags.items() if v is not None}


def heartbeat() -> None:
    crons.capture_checkin(monitor_slug=HEARTBEAT_MONITOR, status="ok", monitor_config=HEARTBEAT_CONFIG)


@contextlib.contextmanager
def reaper_checkin() -> Iterator[None]:
    check_in_id = crons.capture_checkin(monitor_slug=REAPER_MONITOR, status="in_progress",
                                        monitor_config=REAPER_CONFIG)
    try:
        yield
    except Exception:
        crons.capture_checkin(monitor_slug=REAPER_MONITOR, check_in_id=check_in_id, status="error")
        raise
    crons.capture_checkin(monitor_slug=REAPER_MONITOR, check_in_id=check_in_id, status="ok")


# ── Langfuse ────────────────────────────────────────────────────────────────────────────────────────
_langfuse: Any = None


def init_langfuse(settings: Settings, **overrides: Any) -> Any:
    """One client per process. Tracing is off unless both keys are set (CI and local runs without secrets)."""
    global _langfuse
    from langfuse import Langfuse

    enabled = settings.langfuse_enabled or "span_exporter" in overrides
    _langfuse = Langfuse(
        public_key=settings.langfuse_public_key.get_secret_value() if settings.langfuse_public_key else "pk-lf-off",
        secret_key=settings.langfuse_secret_key.get_secret_value() if settings.langfuse_secret_key else "sk-lf-off",
        base_url=settings.langfuse_base_url,
        environment=settings.env,
        release=settings.release,
        tracing_enabled=enabled,
        additional_headers={"x-langfuse-ingestion-version": "4"},  # as the doctor: readable at once, not in 10 min
        **overrides,
    )
    if not enabled:
        log.info("langfuse disabled: LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set")
    return _langfuse


def langfuse() -> Any:
    if _langfuse is None:
        return init_langfuse(Settings())
    return _langfuse


def job_trace_id(kind: str, job_id: object) -> str:
    from langfuse import Langfuse

    return Langfuse.create_trace_id(seed=f"job:{kind}:{job_id}")


@contextlib.contextmanager
def job_observation(job: Any) -> Iterator[Any]:
    """The Langfuse trace `job:<kind>:<id>` (docs/17); model calls inside become its generations."""
    from langfuse import propagate_attributes

    name = f"job:{job.kind}:{job.id}"
    lf = langfuse()
    with lf.start_as_current_observation(trace_context={"trace_id": job_trace_id(job.kind, job.id)}, name=name,
                                         as_type="span", metadata=job_tags(job)) as span, \
            propagate_attributes(trace_name=name, metadata=job_tags(job)):
        yield span


def flush() -> None:
    with contextlib.suppress(Exception):
        if _langfuse is not None:
            _langfuse.flush()
    with contextlib.suppress(Exception):
        sentry_sdk.flush(timeout=5)
