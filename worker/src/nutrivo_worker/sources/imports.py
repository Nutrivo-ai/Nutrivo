"""What an import run reports: one visible outcome per pull and per entry, never a silent drop (docs/18).

Pulls (the bodies fetched from a source) end `stored`, `unchanged`, `fetched` (dry run) or `failed`. Entries end
`imported` (row written or changed), `unchanged` (row already as the source says), `importable` (dry run),
`skipped` (the source does not let us write the row without guessing; `reason` says why) or `stale` (a row an earlier
import wrote that this pull does not support; it is left in place and reported)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

import sentry_sdk

from ..logs import get_logger, kv
from .http import SourceError

log = get_logger(__name__)

Status = Literal["stored", "unchanged", "fetched", "failed", "imported", "importable", "skipped", "stale"]


@dataclass
class Outcome:
    kind: Literal["pull", "additive", "material"]
    item: str                       # pull name, policy item code or catalogue number
    status: Status
    id: str | None = None           # the row key: identification number or catalogue number
    language: str | None = None
    sha256: str | None = None
    url: str | None = None
    source_id: str | None = None
    reason: str | None = None
    note: str | None = None
    languages_missing: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v not in (None, [])}


def failed(kind: Literal["pull", "additive", "material"], item: str, exc: Exception, *, register: str,
           **extra: object) -> Outcome:
    """A failure as an outcome, sent to Sentry with ids and the reason code only."""
    reason = getattr(exc, "reason", None) if isinstance(exc, SourceError) else None
    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("source_register", register)
        scope.set_tag("source_item", item)
        scope.set_tag("reason", reason or type(exc).__name__)
        sentry_sdk.capture_exception(exc)
    log.error("source import failed", extra=kv(register=register, item=item, reason=reason or type(exc).__name__))
    return Outcome(kind, item, "failed", reason=reason or f"error:{type(exc).__name__}",
                   note=str(exc)[:300] if isinstance(exc, SourceError) else None, **extra)  # type: ignore[arg-type]


def summary(outcomes: list[Outcome]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for o in outcomes:
        key = o.status if o.status != "skipped" else f"skipped:{o.reason}"
        out.setdefault(o.kind, {})[key] = out.setdefault(o.kind, {}).get(key, 0) + 1
    return out
