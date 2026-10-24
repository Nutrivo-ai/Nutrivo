"""One fetch run over content/sources.yaml: for each act, its latest consolidated version in each launch language.

Every document ends in a visible state: `stored` (new body, new ref.sources row), `unchanged` (same sha256 already
stored, no row), `fetched` (dry run: hashed, not stored) or `failed` with a reason code. Failures go to Sentry with
ids and the reason only; the run carries on with the next document and the command exits non-zero."""
from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Literal

import sentry_sdk
import yaml

from ..logs import get_logger, kv
from . import eurlex
from .http import PoliteClient, SourceError
from .store import Meta, SourceStore

log = get_logger(__name__)

Status = Literal["stored", "unchanged", "fetched", "failed"]


@dataclass(frozen=True)
class Act:
    celex: str
    title: str


@dataclass
class Result:
    act: str
    language: str
    status: Status
    celex: str | None = None
    consolidated_on: str | None = None
    sha256: str | None = None
    url: str | None = None
    source_id: str | None = None
    reason: str | None = None
    note: str | None = None
    later_versions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v not in (None, [])}


def load_sources(path: Path) -> tuple[list[Act], list[str], str]:
    data = yaml.safe_load(path.read_text())
    acts = [Act(eurlex.check_act(str(a["celex"])), str(a["title"])) for a in data.get("acts") or []]
    return acts, [str(lang) for lang in data.get("languages") or []], str(data.get("licence") or "unknown")


def _failed(act: str, language: str, exc: Exception, **extra: object) -> Result:
    reason = getattr(exc, "reason", None) if isinstance(exc, SourceError) else None
    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("source_act", act)
        scope.set_tag("source_language", language)
        scope.set_tag("reason", reason or type(exc).__name__)
        sentry_sdk.capture_exception(exc)
    log.error("source fetch failed", extra=kv(act=act, language=language, reason=reason or type(exc).__name__))
    return Result(act, language, "failed", reason=reason or f"error:{type(exc).__name__}",
                  note=str(exc)[:300] if isinstance(exc, SourceError) else None, **extra)  # type: ignore[arg-type]


def run(acts: Iterable[Act], languages: Iterable[str], client: PoliteClient, store: SourceStore | None, *,
        licence: str = "eu_reuse", today: date | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> list[Result]:
    """Fetch every act × language. With `store` None it is a dry run: fetched and hashed, nothing written."""
    today = today or now().date()
    langs = list(languages)
    results: list[Result] = []
    for act in acts:
        try:
            current, later = eurlex.pick(eurlex.consolidations(client, act.celex), today)
        except Exception as exc:  # noqa: BLE001  every document of the act fails visibly; the run goes on
            results.extend(_failed(act.celex, lang, exc) for lang in langs)
            continue
        celex = current.celex if current else act.celex
        note = None if current else "no consolidated version in CELLAR: the act as published"
        title = f"{act.title} · consolidated text {current.consolidated_on.isoformat()}" if current else act.title
        common = {"celex": celex, "consolidated_on": current.consolidated_on.isoformat() if current else None,
                  "later_versions": [v.celex for v in later]}
        for lang in langs:
            try:
                doc = eurlex.fetch(client, celex, lang)
                if store is None:
                    results.append(Result(act.celex, lang, "fetched", sha256=doc.sha256, url=doc.url, note=note,
                                          **common))  # type: ignore[arg-type]
                    continue
                status, source_id = store.save(doc, Meta(title=title, licence=licence), now())
            except Exception as exc:  # noqa: BLE001
                results.append(_failed(act.celex, lang, exc, **common))
                continue
            log.info("source " + status, extra=kv(act=act.celex, celex=celex, language=lang, sha256=doc.sha256,
                                                   source_id=source_id))
            results.append(Result(act.celex, lang, status, sha256=doc.sha256, url=doc.url, source_id=source_id,
                                  note=note, **common))  # type: ignore[arg-type]
    return results
