"""JSON lines on stdout (docs/17): ts, level, msg, request_id, job_id, job_kind, workspace (a hash), release.
Log ids, never customer text and never secrets. Job fields come from a context variable set around each job."""
from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import logging
import sys
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

_context: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("nutrivo_log_context", default=None)
_release = "dev"
FIELDS = ("request_id", "job_id", "job_kind", "workspace")


def workspace_hash(workspace_id: object | None) -> str | None:
    """A stable, non-reversible tag for a workspace: never its name, never its raw id in third-party tools."""
    if workspace_id is None:
        return None
    return hashlib.sha256(str(workspace_id).encode()).hexdigest()[:16]


@contextlib.contextmanager
def log_context(**fields: Any) -> Iterator[None]:
    token = _context.set({**(_context.get() or {}), **{k: v for k, v in fields.items() if v is not None}})
    try:
        yield
    finally:
        _context.reset(token)


def current_context() -> dict[str, Any]:
    return dict(_context.get() or {})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            "logger": record.name,
            "release": _release,
        }
        ctx = _context.get() or {}
        for key in FIELDS:
            if key in ctx:
                line[key] = str(ctx[key])
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            line.update({k: v for k, v in extra.items() if k not in line})
        if record.exc_info and record.exc_info[0] is not None:
            line["error_type"] = record.exc_info[0].__name__   # the type only: messages can carry customer text
        return json.dumps(line, default=str)


def setup_logging(release: str, level: int = logging.INFO, stream: Any = None) -> None:
    global _release
    _release = release
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("httpx", "httpcore", "botocore", "urllib3", "opentelemetry"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def kv(**fields: Any) -> dict[str, Any]:
    """`log.info("msg", extra=kv(attempt=2))`: structured fields on one line."""
    return {"fields": fields}
