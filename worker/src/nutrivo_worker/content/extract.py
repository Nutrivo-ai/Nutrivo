"""K01/K02: two independent extractions of a target from a stored official text, compared field by field.

For each target × stored source (one per language):
1. The source must be a stored EUR-Lex text: kind `eurlex`, a sha256 and a storage path, nothing naming FEDIAF or
   AAFCO, and a body whose sha256 matches the row. Otherwise it is refused before any model is called.
2. The units the target names (articles, annexes) are cut from that body; the model sees those units only.
3. K01: `extraction_primary` (extraction model class). Every verbatim field must be printed in the units; otherwise
   the result is withheld (`excerpt_not_in_source`) and no candidate is written.
4. K02: `extraction_secondary` (judgement model class, its own prompt), with the same inputs and never the first
   result. `agree` holds only when both found the target, both are verbatim, and every field matches.
5. The candidate is `pending`, or `needs_review` on any disagreement and for every threshold and prescribed wording
   (D-10). Nothing here sets `accepted` or writes ref.rules or ref.rule_versions: acceptance is a person's (K03).

Idempotent per (source_id, rule key): a candidate with both values is `unchanged`, one with the first value only
resumes at the second, and a decided one is never touched. Every pair ends in a visible state with a reason code."""
from __future__ import annotations

import contextlib
import hashlib
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from typing import Any, Literal, Protocol

import sentry_sdk

from .. import observability as obs
from ..errors import ModelError, SafeError
from ..logs import get_logger, kv
from ..models import ModelResult, Models
from . import articles
from .schemas import OUTPUT_SCHEMAS, VERBATIM
from .targets import REFUSED_SOURCES, Target

log = get_logger(__name__)

PROMPT_VERSION = "v1"
PRIMARY, SECONDARY = "extraction_primary", "extraction_secondary"
OPEN_DECISIONS = ("pending", "needs_review")          # the only decisions extraction ever writes
REVIEW_SHAPES = ("threshold", "prescribed_wording")   # extracted twice and always reviewed (D-10)

Status = Literal["stored", "updated", "unchanged", "extracted", "skipped", "withheld", "failed"]


class SourceRefused(SafeError):
    reason = "source_refused"

    def __init__(self, message: str, reason: str):
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class SourceRow:
    id: str
    kind: str
    celex: str | None
    language: str | None
    title: str
    url: str
    sha256: str | None
    storage_path: str | None


@dataclass(frozen=True)
class Candidate:
    id: str
    first_value: dict[str, Any] | None
    second_value: dict[str, Any] | None
    decision: str


class SourceReader(Protocol):
    def sources(self, act: str, languages: list[str] | None) -> list[SourceRow]: ...
    def body(self, row: SourceRow) -> bytes: ...


class CandidateStore(Protocol):
    def locked(self, source_id: str, rule_key: str) -> contextlib.AbstractContextManager[None]: ...
    def find(self, source_id: str, rule_key: str) -> Candidate | None: ...
    def insert_first(self, source_id: str, rule_key: str, article: str, source_ref: str,
                     first_value: dict[str, Any]) -> str: ...
    def set_second(self, candidate_id: str, second_value: dict[str, Any], agree: bool, decision: str) -> bool: ...
    def insert_model_call(self, row: dict[str, Any]) -> None: ...


@dataclass
class Result:
    target: str
    status: Status
    source_id: str | None = None
    celex: str | None = None
    language: str | None = None
    candidate_id: str | None = None
    agree: bool | None = None
    decision: str | None = None
    disagreements: list[str] | None = None
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ── checks ──────────────────────────────────────────────────────────────────────────────────────────
def check_source(row: SourceRow, act: str) -> None:
    """K01.must.1: only a stored EUR-Lex text of the target's act; FEDIAF and AAFCO are never sources."""
    if REFUSED_SOURCES.search(" ".join(filter(None, (row.title, row.url, row.celex)))):
        raise SourceRefused(f"source {row.id} names a copyrighted industry text", "source_refused")
    if row.kind != "eurlex":
        raise SourceRefused(f"source {row.id} is kind {row.kind}, not eurlex", "source_kind_refused")
    if not (row.sha256 and row.storage_path):
        raise SourceRefused(f"source {row.id} has no stored body", "source_not_stored")
    if not row.celex or not (row.celex == act or row.celex.startswith("0" + act[1:] + "-")):
        raise SourceRefused(f"source {row.id} is not act {act}", "source_act_mismatch")


def check_body(row: SourceRow, body: bytes) -> None:
    if hashlib.sha256(body).hexdigest() != row.sha256:
        raise SourceRefused(f"source {row.id} body does not match its sha256", "source_hash_mismatch")


def _verbatim_values(params: Any, path: str) -> list[str]:
    head, _, rest = path.partition(".")
    value = params.get(head) if isinstance(params, dict) else None
    items = value if isinstance(value, list) else [value]
    if rest:
        return [v for item in items for v in _verbatim_values(item, rest)]
    return [v for v in items if isinstance(v, str)]


def unverified_fields(shape: str, output: dict[str, Any], text: str) -> list[str]:
    """The verbatim fields whose value the stored text does not print: empty means every value is from the text."""
    missing = [] if articles.contains(text, output.get("excerpt") or "") else ["excerpt"]
    for path in VERBATIM[shape]:
        if any(not articles.contains(text, v) for v in _verbatim_values(output.get("params") or {}, path)):
            missing.append(f"params.{path}")
    return missing


# ── comparison (K02) ────────────────────────────────────────────────────────────────────────────────
def _norm(v: Any) -> Any:
    if isinstance(v, str):
        return articles.normalise(v).casefold()
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, int | float):
        return float(v)
    if isinstance(v, list):
        return sorted((_norm(x) for x in v), key=lambda x: json.dumps(x, sort_keys=True, default=str))
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    return v


def _flatten(prefix: str, v: Any, out: dict[str, Any]) -> None:
    if isinstance(v, dict) and v:
        for k, x in v.items():
            _flatten(f"{prefix}.{k}" if prefix else k, x, out)
    else:
        out[prefix] = v


def _article_key(ref: str) -> str:
    return "".join(ch for ch in ref.casefold() if ch.isalnum() or ch in "()")


def compare(first: dict[str, Any], second: dict[str, Any]) -> dict[str, bool]:
    """Field by field: found, the article reference and every param (lists compared as sets, case-folded). The
    excerpts are not compared: two correct excerpts may differ in extent; both are checked against the text."""
    a: dict[str, Any] = {"found": first.get("found"), "article_ref": _article_key(first.get("article_ref") or "")}
    b: dict[str, Any] = {"found": second.get("found"), "article_ref": _article_key(second.get("article_ref") or "")}
    _flatten("params", _norm(first.get("params")), a)
    _flatten("params", _norm(second.get("params")), b)
    return {k: a.get(k) == b.get(k) for k in sorted(set(a) | set(b))}


# ── the run ─────────────────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Extracted:
    value: dict[str, Any]        # what the candidate row stores
    output: dict[str, Any]       # the model's validated answer
    verified: bool


def _inputs(target: Target, row: SourceRow, units: dict[str, articles.Unit]) -> dict[str, Any]:
    return {"target": {"key": target.key, "shape": target.shape, "domain": target.domain,
                       "named_in": target.candidate_source, "extract": target.extract or ""},
            "language": row.language or "",
            "units": "\n\n".join(f"[{u.label}]\n{u.text}" for u in units.values())}


def _extract(models: Models, purpose: str, target: Target, row: SourceRow, units: dict[str, articles.Unit],
             store: CandidateStore | None) -> Extracted:
    res: ModelResult = models.call_full(purpose, PROMPT_VERSION, _inputs(target, row, units),
                                        OUTPUT_SCHEMAS[target.shape], store=store)
    output = res.raw_output
    text = "\n".join(u.text for u in units.values())
    missing = unverified_fields(target.shape, output, text) if output.get("found") else []
    value = {"extraction": output, "verified": not missing, "unverified_fields": missing,
             "prompt_version": f"{purpose}.{PROMPT_VERSION}", "model_id": res.model_id, "provider": res.provider,
             "input_hash": res.input_hash, "source_sha256": row.sha256, "units": list(units)}
    return Extracted(value, output, not missing)


@contextlib.contextmanager
def _trace(target: Target, row: SourceRow) -> Iterator[None]:
    with obs.content_observation(f"content:extract:{target.key}:{row.id}",
                                 {"rule_key": target.key, "source_id": row.id, "language": row.language or "",
                                  "celex": row.celex or ""}):
        yield


def extract_pair(target: Target, row: SourceRow, reader: SourceReader, store: CandidateStore | None,
                 models: Models) -> Result:
    base = {"target": target.key, "source_id": row.id, "celex": row.celex, "language": row.language}
    try:
        check_source(row, target.act or "")
    except SourceRefused as exc:
        return Result(**base, status="failed", reason=exc.reason)   # type: ignore[arg-type]
    lock = store.locked(row.id, target.key) if store else contextlib.nullcontext()
    with lock:
        existing = store.find(row.id, target.key) if store else None
        if existing and (existing.decision not in OPEN_DECISIONS or existing.second_value is not None):
            return Result(**base, status="unchanged", candidate_id=existing.id,  # type: ignore[arg-type]
                          decision=existing.decision)
        body = reader.body(row)
        check_body(row, body)
        all_units = articles.split_units(body)
        units = {label: all_units[label] for label in target.units if label in all_units}
        if not units:
            return Result(**base, status="withheld", reason="units_not_in_source")  # type: ignore[arg-type]
        with _trace(target, row):
            candidate_id: str | None = existing.id if existing else None
            if existing:
                first_value = existing.first_value or {}
                first = first_value.get("extraction") or {}
                status: Status = "updated"
            else:
                one = _extract(models, PRIMARY, target, row, units, store)
                if not one.output.get("found"):
                    return Result(**base, status="withheld", reason="not_found")  # type: ignore[arg-type]
                if not one.verified:
                    log.warning("extraction not verbatim", extra=kv(rule_key=target.key, source_id=row.id,
                                                                     fields=",".join(one.value["unverified_fields"])))
                    return Result(**base, status="withheld", reason="excerpt_not_in_source")  # type: ignore[arg-type]
                first, first_value, status = one.output, one.value, "stored"
                if store is not None:   # stored before the second key, so a failed second call resumes there
                    candidate_id = store.insert_first(
                        row.id, target.key, unit_of(first, units),
                        f"{row.celex} {row.language} {first.get('article_ref', '')}".strip(), first_value)
            two = _extract(models, SECONDARY, target, row, units, store)
        fields = compare(first, two.output)
        agree = bool(first_value.get("verified")) and two.verified and all(fields.values())
        decision = "needs_review" if (not agree or target.shape in REVIEW_SHAPES) else "pending"
        second_value = {**two.value, "fields": fields}
        disagreements = [k for k, ok in fields.items() if not ok] + (["second.unverified"] if not two.verified else [])
        if store is None or candidate_id is None:
            return Result(**base, status="extracted", agree=agree, decision=decision,  # type: ignore[arg-type]
                          disagreements=disagreements or None)
        if not store.set_second(candidate_id, second_value, agree, decision):
            return Result(**base, status="unchanged", candidate_id=candidate_id,  # type: ignore[arg-type]
                          reason="decided_meanwhile")
        return Result(**base, status=status, candidate_id=candidate_id, agree=agree,  # type: ignore[arg-type]
                      decision=decision, disagreements=disagreements or None)


def unit_of(first: dict[str, Any], units: dict[str, articles.Unit]) -> str:
    """The unit the excerpt was found in ("Art. 15"): ref.rule_candidates.article."""
    excerpt = first.get("excerpt") or ""
    return next((label for label, u in units.items() if articles.contains(u.text, excerpt)), next(iter(units)))


def run(targets: Iterable[Target], reader: SourceReader, store: CandidateStore | None, models: Models, *,
        languages: list[str] | None = None) -> list[Result]:
    """Every extractable target × its stored sources. A failure is reported and the run goes on."""
    results: list[Result] = []
    for target in targets:
        if target.skip_reason:
            results.append(Result(target.key, "skipped", reason=target.skip_reason))
            continue
        try:
            rows = reader.sources(target.act or "", languages)
        except Exception as exc:  # noqa: BLE001  visible, reported, the run goes on
            results.append(_failed(Result(target.key, "failed"), exc))
            continue
        if not rows:
            results.append(Result(target.key, "withheld", reason="source_not_stored"))
            continue
        for row in rows:
            try:
                results.append(extract_pair(target, row, reader, store, models))
            except Exception as exc:  # noqa: BLE001
                results.append(_failed(Result(target.key, "failed", source_id=row.id, celex=row.celex,
                                              language=row.language), exc))
    return results


def _failed(result: Result, exc: Exception) -> Result:
    reason = getattr(exc, "reason", None) if isinstance(exc, SafeError | ModelError) else None
    result.reason = reason or f"error:{type(exc).__name__}"
    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("rule_key", result.target)
        scope.set_tag("source_id", result.source_id or "")
        scope.set_tag("reason", result.reason)
        sentry_sdk.capture_exception(exc)
    log.error("content extraction failed", extra=kv(rule_key=result.target, source_id=result.source_id,
                                                    reason=result.reason))
    return result
