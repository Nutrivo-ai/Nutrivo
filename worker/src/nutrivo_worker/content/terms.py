"""K01/K02 for terms: candidate term register entries (`ref.term_entries`, status 'candidate') read from each stored
official language version, never translated (BE-11, D-31).

For each term group in content/candidates/eu-core-terms.yaml × stored source (one per language):
1. The source passes the same checks as a rule extraction (`extract.check_source`, `extract.check_body`): a stored
   EUR-Lex text of the group's act whose body matches its sha256. Otherwise it fails before any model is called.
2. The units the group names are cut from that body; the model sees those units only.
3. Two independent keys: `term_extraction_primary` (extraction class) and `term_extraction_secondary` (judgement
   class, its own prompt, never the first answer). Each returns, per requested term key, the term as printed, its
   article reference and an excerpt.
4. A candidate entry is written only when both keys found the term, each key's term is printed as whole words (up
   to whitespace) on one printed line of the units, the two terms are the same string, and at least one key's excerpt locates it there.
   The excerpt is a locator, matched up to the style of quotation marks and dashes, which models do not reliably
   copy; the term never is, and only the printed term is stored. Anything else is withheld with a reason and
   writes nothing: a person never sees a term only one key read, or one not printed in that language's own text.
5. Nothing here accepts or rejects a term: that is `app.decide_term`, a person's click in /admin/terms (K03).

Idempotent per (term key, language, source): an entry from the same source in any status is `unchanged`, and a
group whose entries all exist calls no model. A rejected entry is never proposed again from the same text."""
from __future__ import annotations

import contextlib
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

import sentry_sdk
import yaml
from pydantic import BaseModel, ConfigDict, Field

from .. import observability as obs
from ..errors import ModelError, SafeError
from ..logs import get_logger, kv
from ..models import Models
from . import articles
from .extract import SourceReader, SourceRefused, SourceRow, check_body, check_source
from .targets import REFUSED_SOURCES, TargetError, resolve

log = get_logger(__name__)

PROMPT_VERSION = "v1"
PRIMARY, SECONDARY = "term_extraction_primary", "term_extraction_secondary"
KINDS = ("prescribed_designation", "heading", "analytical_constituent", "category", "claim_term")  # ref.term_entries
_TERM_KEY = re.compile(r"^[a-z][a-z0-9_]*$")
# A trailing ellipsis is the act's placeholder for what follows on a label (‘best before …’ followed by the date):
# it is dropped, so the term is the printed words a label carries; what remains is still printed verbatim.
_ELLIPSIS = re.compile(r"\s*(?:…|\.\.\.)$")

Status = Literal["stored", "unchanged", "extracted", "skipped", "withheld", "failed"]


# ── the targets file ────────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class TermSpec:
    key: str
    find: str


@dataclass(frozen=True)
class TermGroup:
    group: str
    kind: str
    candidate_source: str
    act: str | None
    units: tuple[str, ...]
    terms: tuple[TermSpec, ...]

    @property
    def skip_reason(self) -> str | None:
        if REFUSED_SOURCES.search(self.candidate_source):
            return "source_refused"
        if not self.act:
            return "act_not_resolved"
        if not self.units:
            return "no_units_named"
        return None


def load_groups(path: Path, listed_acts: set[str]) -> list[TermGroup]:
    """Each group resolved to its act and units like a rule target (targets.resolve). A malformed file stops the
    run: an unknown kind, a term key that is not snake_case, or a key named twice."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out, seen = [], set()
    for g in data.get("groups") or []:
        name = str(g.get("group") or "")
        if not name or not g.get("candidate_source") or g.get("kind") not in KINDS or not g.get("terms"):
            raise TargetError(f"term group {name[:60]!r} lacks group, a known kind, candidate_source or terms")
        specs = []
        for t in g["terms"]:
            key = str(t.get("key") or "")
            if not _TERM_KEY.match(key) or not t.get("find") or key in seen:
                raise TargetError(f"term group {name[:60]!r}: term key {key[:60]!r} is invalid or named twice")
            seen.add(key)
            specs.append(TermSpec(key, str(t["find"])))
        act, units = resolve(str(g["candidate_source"]))
        out.append(TermGroup(name, str(g["kind"]), str(g["candidate_source"]), act if act in listed_acts else None,
                             units, tuple(specs)))
    return out


# ── what a key returns ──────────────────────────────────────────────────────────────────────────────
class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TermAnswer(_Closed):
    key: str = Field(description="The term key exactly as given in `terms`")
    found: bool = Field(description="False when the units do not print this term; never guess")
    term: str = Field(description="The term exactly as printed in the units, without surrounding quotation marks; "
                                  "empty when not found")
    article_ref: str = Field(description="Exact to the paragraph and point: 'Art. 15(a)' or 'Annex VII Chapter II "
                                         "point 1'; empty when not found")
    excerpt: str = Field(description="The shortest passage of the units that prints the term, copied exactly, "
                                     "quotation marks included; empty when not found")


class TermsExtraction(_Closed):
    answers: list[TermAnswer] = Field(description="One answer per requested term key")


@dataclass(frozen=True)
class KeyRead:
    found: bool
    term: str
    article_ref: str
    printed: bool       # the term is printed in the units, verbatim up to whitespace
    located: bool       # and inside the passage this key's excerpt locates


def verify(answer: TermAnswer, units: list[str]) -> KeyRead:
    """A key's read of one term, against the text of each unit. The term must be printed as whole words, up to
    whitespace, on one printed line of a unit ('Crude fibre' is not printed in 'Crude fibres'), with an article
    reference for the person to check it against. The excerpt is a locator only: it is found within one unit up to
    the style of its quotation marks and dashes (`articles.locate`), which models do not reliably copy; the term never
    is, and only the printed term is ever stored. A trailing ellipsis (the act's placeholder for a date) is dropped
    first."""
    term = _ELLIPSIS.sub("", articles.normalise(answer.term))
    found = bool(answer.found and term)
    printed = bool(found and answer.article_ref.strip()
                   and any(articles.printed_as_words(line, term) for u in units for line in u.split("\n")))
    located = False
    if printed:
        for u in units:
            passage = articles.locate(u, answer.excerpt)
            if passage and articles.printed_as_words(passage, term):
                located = True
                break
    return KeyRead(found, term, answer.article_ref.strip(), printed, located)


# ── persistence ─────────────────────────────────────────────────────────────────────────────────────
class TermStore(Protocol):
    def locked(self, source_id: str, group: str) -> contextlib.AbstractContextManager[None]: ...
    def existing(self, source_id: str, language: str, term_keys: list[str]) -> dict[str, tuple[str, str]]: ...
    def insert(self, term_key: str, language: str, term: str, kind: str, article_ref: str, source_id: str) -> str: ...
    def insert_model_call(self, row: dict[str, Any]) -> None: ...


@dataclass
class Result:
    group: str
    status: Status
    term_key: str | None = None
    source_id: str | None = None
    celex: str | None = None
    language: str | None = None
    term_entry_id: str | None = None
    reason: str | None = None
    first: str | None = None      # the two printed terms, shown only when the keys disagree (official text, no PII)
    second: str | None = None
    missing_units: list[str] | None = None   # with units_not_in_source: the named units the stored text lacks

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ── the run ─────────────────────────────────────────────────────────────────────────────────────────
def _inputs(group: TermGroup, row: SourceRow, units: dict[str, articles.Unit], specs: list[TermSpec]) -> dict:
    return {"group": {"key": group.group, "kind": group.kind, "named_in": group.candidate_source},
            "terms": [{"key": s.key, "find": s.find} for s in specs],
            "language": row.language or "",
            "units": "\n\n".join(f"[{u.label}]\n{u.text}" for u in units.values())}


def _read(models: Models, purpose: str, inputs: dict, store: TermStore | None,
          texts: list[str]) -> dict[str, KeyRead]:
    res = models.call_full(purpose, PROMPT_VERSION, inputs, TermsExtraction, store=store)
    out: dict[str, KeyRead] = {}
    for a in TermsExtraction.model_validate(res.raw_output).answers:
        if a.key not in out:                     # the first answer for a key counts; unknown keys are ignored
            out[a.key] = verify(a, texts)
    return out


def decide(first: KeyRead | None, second: KeyRead | None) -> str | None:
    """None when the term may be written: both keys found it, each read is printed verbatim in the units, the two are
    the same string, and at least one key's excerpt locates it. Otherwise the reason it is withheld."""
    if not (first and first.found) and not (second and second.found):
        return "not_found"
    if not (first and first.found) or not (second and second.found):
        return "keys_disagree"
    if not first.printed:
        return "excerpt_not_in_source"
    if not second.printed:
        return "second_not_verbatim"
    if first.term != second.term:
        return "keys_disagree"
    if not (first.located or second.located):
        return "excerpt_not_in_source"
    return None


@contextlib.contextmanager
def _trace(group: TermGroup, row: SourceRow) -> Iterator[None]:
    with obs.content_observation(f"content:terms:{group.group}:{row.id}",
                                 {"group": group.group, "source_id": row.id, "language": row.language or "",
                                  "celex": row.celex or ""}):
        yield


def extract_group(group: TermGroup, row: SourceRow, reader: SourceReader, store: TermStore | None,
                  models: Models) -> list[Result]:
    base = {"group": group.group, "source_id": row.id, "celex": row.celex, "language": row.language}
    try:
        check_source(row, group.act or "")
    except SourceRefused as exc:
        return [Result(**base, status="failed", reason=exc.reason)]  # type: ignore[arg-type]
    lock = store.locked(row.id, group.group) if store else contextlib.nullcontext()
    with lock:
        keys = [s.key for s in group.terms]
        have = store.existing(row.id, row.language or "", keys) if store else {}
        results = [Result(**base, status="unchanged", term_key=k, term_entry_id=have[k][0],  # type: ignore[arg-type]
                          reason=f"already_{have[k][1]}") for k in keys if k in have]
        todo = [s for s in group.terms if s.key not in have]
        if not todo:
            return results
        body = reader.body(row)
        check_body(row, body)
        all_units = articles.split_units(body)
        # Every unit the group names, or none: terms are never read from part of what the group names.
        if missing := [label for label in group.units if label not in all_units]:
            return results + [Result(**base, status="withheld", term_key=s.key,  # type: ignore[arg-type]
                                     reason="units_not_in_source", missing_units=missing) for s in todo]
        units = {label: all_units[label] for label in group.units}
        texts = [u.text for u in units.values()]
        inputs = _inputs(group, row, units, todo)
        with _trace(group, row):
            first = _read(models, PRIMARY, inputs, store, texts)
            second = _read(models, SECONDARY, inputs, store, texts)
        for spec in todo:
            a, b = first.get(spec.key), second.get(spec.key)
            reason = decide(a, b)
            if reason:
                shown = {"first": a.term, "second": b.term} if reason == "keys_disagree" and a and b else {}
                results.append(Result(**base, status="withheld", term_key=spec.key,  # type: ignore[arg-type]
                                      reason=reason, **shown))
                continue
            assert a is not None
            if store is None:
                results.append(Result(**base, status="extracted", term_key=spec.key))  # type: ignore[arg-type]
                continue
            entry = store.insert(spec.key, row.language or "", a.term, group.kind, a.article_ref, row.id)
            results.append(Result(**base, status="stored", term_key=spec.key,  # type: ignore[arg-type]
                                  term_entry_id=entry))
        return results


def run(groups: Iterable[TermGroup], reader: SourceReader, store: TermStore | None, models: Models, *,
        languages: list[str] | None = None) -> list[Result]:
    """Every term group × its stored sources. A failure is reported and the run goes on."""
    results: list[Result] = []
    for group in groups:
        if group.skip_reason:
            results.append(Result(group.group, "skipped", reason=group.skip_reason))
            continue
        try:
            rows = reader.sources(group.act or "", languages)
        except Exception as exc:  # noqa: BLE001  visible, reported, the run goes on
            results.append(_failed(Result(group.group, "failed"), exc))
            continue
        if not rows:
            results.append(Result(group.group, "withheld", reason="source_not_stored"))
            continue
        for row in rows:
            try:
                results.extend(extract_group(group, row, reader, store, models))
            except Exception as exc:  # noqa: BLE001
                results.append(_failed(Result(group.group, "failed", source_id=row.id, celex=row.celex,
                                              language=row.language), exc))
    return results


def _failed(result: Result, exc: Exception) -> Result:
    reason = getattr(exc, "reason", None) if isinstance(exc, SafeError | ModelError) else None
    result.reason = reason or f"error:{type(exc).__name__}"
    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("term_group", result.group)
        scope.set_tag("source_id", result.source_id or "")
        scope.set_tag("reason", result.reason)
        sentry_sdk.capture_exception(exc)
    log.error("term extraction failed", extra=kv(term_group=result.group, source_id=result.source_id,
                                                 reason=result.reason))
    return result
