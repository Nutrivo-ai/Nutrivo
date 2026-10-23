"""The weekly source watch (J01): new official documents linked to the acts we follow, triaged by a model for a person.

- CELLAR, the repository EUR-Lex and the Official Journal are published from (docs/14 §6), is asked once per act for
  works that amend, are based on, correct or cite it and are dated on or after `since`, with their English title.
  Consolidated versions dated after the run date are listed too. Nothing is fetched or stored: the run is read only,
  so running it again gives the same report.
- The document kind comes from the CELEX id alone (sector and type), never from the model.
- The model only ranks and summarises (`triage`): it never decides coverage, a stage or a date. Its schema has no
  field for either, and a summary that states a date, or calls a document that is not a legal act law, is withheld
  (BE-37). Abstention, a refusal or an unusable answer is withheld with its reason; the item stays in the report.
- A person reads the report and records horizon items (`nutrivo horizon record`, sources/horizon.py)."""
from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Literal
from urllib.parse import urlencode

import sentry_sdk
from pydantic import BaseModel, ConfigDict, Field

from ..errors import ModelError, SafeError
from ..logs import get_logger, kv
from ..models import ModelCallStore, Models
from . import eurlex
from .fetch import Act
from .http import PoliteClient, SourceError

log = get_logger(__name__)

PROMPT_VERSION = "v1"
DEFAULT_LOOKBACK_DAYS = 14          # a weekly run with a week's overlap: nothing published late is missed
DEFAULT_MAX_ITEMS = 60              # model calls per run are bounded; the rest are listed, withheld
READER_URL = "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:{celex}"
ENGLISH = "http://publications.europa.eu/resource/authority/language/ENG"
RELATIONS = {                       # CDM property → how the report names the link to the followed act
    "resource_legal_amends_resource_legal": "amends",
    "resource_legal_based_on_resource_legal": "based_on",
    "resource_legal_corrects_resource_legal": "corrects",
    "work_cites_work": "cites",
}

Kind = Literal["proposal", "preparatory", "legal_act", "corrigendum", "other"]
Status = Literal["triaged", "withheld"]
Relevance = Literal["high", "medium", "low"]
OFFICIAL_STATUS: dict[str, str] = {
    "proposal": "Commission proposal: not law",
    "preparatory": "Preparatory or information document: not law",
    "legal_act": "Legal act (CELEX sector 3): read the text for its dates",
    "corrigendum": "Corrigendum to a legal act: read the text for its dates",
    "other": "Other document: read it to see what it is",
}
NOT_LAW: frozenset[str] = frozenset({"proposal", "preparatory", "other"})

_SECTOR = re.compile(r"^([0-9A-Z])(\d{4})([A-Z]{1,2})(\d+)(.*)$")      # 52025PC1030(01), 32026H1801, 32009R0767R(08)


def document_kind(celex: str) -> Kind:
    m = _SECTOR.match(celex)
    if not m:
        return "other"
    sector, _year, doc_type, _number, rest = m.groups()
    if sector == "3":
        return "corrigendum" if rest.startswith("R(") else "legal_act"
    if sector == "5":
        return "proposal" if doc_type == "PC" else "preparatory"
    return "other"


class WatchFailed(SafeError):
    """At least one act could not be queried: the report lists it, and the run's check-in is an error."""

    reason = "acts_failed"


# ── the model's answer and the BE-37 guard ─────────────────────────────────────────────────────────
class Triage(BaseModel):
    """What the model may say about a document: no stage, no date, no coverage (BE-37, CLAUDE.md 6)."""

    model_config = ConfigDict(extra="forbid")
    abstain: bool
    relevance: Relevance | None
    summary: str = Field(max_length=600)
    reason: str = Field(max_length=400)


_MONTHS = ("january|february|march|april|may|june|july|august|september|october|november|december|"
           "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec")
_DATE = re.compile(
    r"\b\d{4}-\d{2}-\d{2}\b"                                        # 2027-01-01
    r"|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b"                           # 1.1.2027, 01/01/27
    rf"|\b(?:{_MONTHS})\b\.?\s+(?:\d{{1,2}}(?:st|nd|rd|th)?\b|(?:19|20)\d{{2}}\b)"  # July 2027, Jan 1st
    rf"|\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:{_MONTHS})\b"     # 24 July, 1st of May
    r"|\b(?:from|by|until|till|in|on|as of|before|after|during|end of|start of|early|late|mid)[\s-]+"
    r"(?:19|20)\d{2}\b(?!\s*/)"                                     # from 2027 (not 2017/2279)
    r"|\b(?:Q[1-4]|H[12])\s+(?:19|20)\d{2}\b"                       # Q3 2027
    r"|\b(?:next|this|last|coming|following)\s+(?:year|month|week|spring|summer|autumn|fall|winter)\b"
    r"|\bwithin\s+(?:\d+|a|one|two|three|six|twelve|eighteen|\w+-\w+)\s+(?:days?|weeks?|months?|years?)\b"
    r"|\b(?:deadlines?|dates? of application|application dates?|transition(?:al)? period|postpon\w*|delay\w*)\b",
    re.IGNORECASE)
# Any year that is not part of an act number (767/2009, 2017/2279): withheld on every document that is not law.
_YEAR = re.compile(r"(?<![/\d])\b(?:19|20)\d{2}\b(?!\s*/)")
_AS_LAW = re.compile(
    r"\b(?:in force|into force|applies from|apply from|applicable from|applies as of|takes effect|take effect|"
    r"effective|binding|has been adopted|was adopted|were adopted|is now law|now applies|is law|became law|"
    r"enacted)\b", re.IGNORECASE)


def guard(kind: str, triage: Triage) -> str | None:
    """The reason a model answer is withheld, or None when it may be shown to a person."""
    if triage.abstain or triage.relevance is None:
        return "model_abstained"
    text = f"{triage.summary}\n{triage.reason}"
    if _DATE.search(text) or (kind in NOT_LAW and _YEAR.search(text)):
        return "model_stated_date"            # dates come from the official text, recorded by a person
    if kind in NOT_LAW and _AS_LAW.search(text):
        return "proposal_stated_as_law"       # BE-37
    return None


# ── what the watch finds ───────────────────────────────────────────────────────────────────────────
@dataclass
class Item:
    celex: str
    kind: Kind
    document_date: str
    title: str | None
    related_acts: list[str] = field(default_factory=list)
    relations: list[str] = field(default_factory=list)       # "cites 32009R0767"
    status: Status = "withheld"
    withheld_reason: str | None = None
    relevance: Relevance | None = None
    summary: str | None = None
    reason: str | None = None
    input_hash: str | None = None

    @property
    def official_status(self) -> str:
        return OFFICIAL_STATUS[self.kind]

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["official_status"] = self.official_status
        d["url"] = READER_URL.format(celex=self.celex)
        return {k: v for k, v in d.items() if v not in (None, [])}


@dataclass
class Failure:
    act: str
    reason: str
    note: str | None = None


@dataclass
class Report:
    run_id: str
    started_at: str
    today: str
    since: str
    prompt_version: str
    acts: list[str]
    items: list[Item]
    later_consolidations: list[dict[str, str]]
    failures: list[Failure]

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for i in self.items:
            key = i.relevance if i.status == "triaged" and i.relevance else i.status
            out[key] = out.get(key, 0) + 1
        out["failed_acts"] = len(self.failures)
        return out

    def as_dict(self) -> dict[str, Any]:
        return {"run": {"run_id": self.run_id, "started_at": self.started_at, "today": self.today,
                        "since": self.since, "prompt": f"triage.{self.prompt_version}", "acts": self.acts},
                "summary": self.counts(),
                "items": [i.as_dict() for i in self.items],
                "later_consolidations": self.later_consolidations,
                "failures": [{k: v for k, v in asdict(f).items() if v is not None} for f in self.failures]}

    def to_json(self) -> str:
        return json.dumps(self.as_dict(), indent=2, ensure_ascii=False) + "\n"


def related_query(act: str, since: date) -> str:
    rels = " ".join(f"cdm:{p}" for p in RELATIONS)
    return ("PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n"
            "SELECT ?celex ?date ?rel ?title WHERE { "
            f'?act cdm:resource_legal_id_celex ?actCelex . FILTER(STR(?actCelex) = "{eurlex.check_act(act)}") '
            f"VALUES ?rel {{ {rels} }} "
            "?w ?rel ?act . ?w cdm:resource_legal_id_celex ?celex . ?w cdm:work_date_document ?date . "
            f'FILTER(?date >= "{since.isoformat()}"^^<http://www.w3.org/2001/XMLSchema#date>) '
            f"OPTIONAL {{ ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <{ENGLISH}> ; "
            "cdm:expression_title ?title } } ORDER BY ?date ?celex ?rel")


def related_works(client: PoliteClient, act: str, since: date) -> list[Item]:
    """Works linked to `act` and dated on or after `since`, one Item per CELEX id, oldest first."""
    resp = client.get(f"{eurlex.SPARQL_ENDPOINT}?{urlencode({'query': related_query(act, since)})}",
                      {"Accept": "application/sparql-results+json"})
    if resp.status != 200:
        raise SourceError(f"SPARQL HTTP {resp.status} for works related to {act}", f"http_{resp.status}")
    try:
        bindings = json.loads(resp.body)["results"]["bindings"]
        rows = [(b["celex"]["value"], b["date"]["value"], b["rel"]["value"].rsplit("#", 1)[-1],
                 b.get("title", {}).get("value")) for b in bindings]
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise SourceError(f"SPARQL answer for works related to {act} is not a result set",
                          "bad_sparql_answer") from exc
    items: dict[str, Item] = {}
    for celex, day, rel, title in rows:
        if celex.startswith("0") or rel not in RELATIONS:   # consolidated texts are listed separately
            continue
        item = items.setdefault(celex, Item(celex, document_kind(celex), day[:10], None, [act]))
        relation = f"{RELATIONS[rel]} {act}"
        if relation not in item.relations:
            item.relations.append(relation)
        if title:
            title = " ".join(title.split())
            item.title = min(item.title, title) if item.title else title     # stable when CELLAR lists several
    return list(items.values())


def _merge(found: dict[str, Item], new: Iterable[Item]) -> None:
    for item in new:
        seen = found.get(item.celex)
        if seen is None:
            found[item.celex] = item
            continue
        seen.related_acts += [a for a in item.related_acts if a not in seen.related_acts]
        seen.relations += [r for r in item.relations if r not in seen.relations]
        seen.title = seen.title or item.title


def _failure(act: str, exc: Exception) -> Failure:
    reason = getattr(exc, "reason", None) if isinstance(exc, SourceError) else None
    with sentry_sdk.isolation_scope() as scope:
        scope.set_tag("source_act", act)
        scope.set_tag("reason", reason or type(exc).__name__)
        sentry_sdk.capture_exception(exc)
    log.error("source watch query failed", extra=kv(act=act, reason=reason or type(exc).__name__))
    return Failure(act, reason or f"error:{type(exc).__name__}", str(exc)[:300] if reason else None)


def triage_inputs(item: Item, acts: Sequence[Act]) -> dict[str, Any]:
    """Ids, kinds and official titles only; never a date of ours (the title may carry its own)."""
    return {"document": {"celex": item.celex, "document_kind": item.kind, "title": item.title,
                         "relations": item.relations},
            "followed_acts": [{"celex": a.celex, "title": a.title} for a in acts]}


def triage(item: Item, acts: Sequence[Act], models: Models, store: ModelCallStore | None) -> None:
    if not item.title:
        item.withheld_reason = "no_title"          # nothing to judge from: a person opens the document
        return
    try:
        result = models.call_full("triage", PROMPT_VERSION, triage_inputs(item, acts), Triage, store=store,
                                  max_tokens=1024)
    except ModelError as exc:
        item.withheld_reason = exc.reason
        return
    except Exception as exc:  # noqa: BLE001  one item withheld visibly; the run goes on
        sentry_sdk.capture_exception(exc)
        log.error("triage failed", extra=kv(celex=item.celex, error=type(exc).__name__))
        item.withheld_reason = f"error:{type(exc).__name__}"
        return
    out: Triage = result.output  # type: ignore[assignment]
    item.input_hash = result.input_hash
    reason = guard(item.kind, out)
    if reason:
        item.withheld_reason = reason              # the model's words are not shown
        return
    item.status, item.relevance, item.summary, item.reason = "triaged", out.relevance, out.summary, out.reason


_ORDER = {"high": 0, "withheld": 1, "medium": 2, "low": 3}


def rank(items: Iterable[Item]) -> list[Item]:
    """High first, then withheld (a person must look: abstaining is never low), then medium and low; newest first."""
    by_date = sorted(items, key=lambda i: (i.document_date, i.celex), reverse=True)
    return sorted(by_date, key=lambda i: _ORDER[i.relevance if i.status == "triaged" and i.relevance else "withheld"])


def run(acts: Sequence[Act], client: PoliteClient, models: Models, *, run_id: str, since: date,
        today: date | None = None, known_celex: Iterable[str] = (), store: ModelCallStore | None = None,
        max_items: int = DEFAULT_MAX_ITEMS, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> Report:
    started = now()
    today = today or started.date()
    followed = {a.celex for a in acts}
    known = set(known_celex)
    found: dict[str, Item] = {}
    later: list[dict[str, str]] = []
    failures: list[Failure] = []
    for act in acts:
        try:
            _merge(found, related_works(client, act.celex, since))
            _, ahead = eurlex.pick(eurlex.consolidations(client, act.celex), today)
        except Exception as exc:  # noqa: BLE001  the act fails visibly; the run goes on with the next one
            failures.append(_failure(act.celex, exc))
            continue
        later += [{"act": act.celex, "celex": v.celex, "consolidated_on": v.consolidated_on.isoformat(),
                   "official_status": "Consolidated text dated after the run date"} for v in ahead]
    items = [i for c, i in found.items() if c not in followed and c not in known]
    for n, item in enumerate(sorted(items, key=lambda i: (i.document_date, i.celex), reverse=True)):
        if n >= max_items:
            item.withheld_reason = "not_triaged_limit"
            continue
        triage(item, acts, models, store)
        log.info("source watch item", extra=kv(celex=item.celex, kind=item.kind, status=item.status,
                                               relevance=item.relevance, reason=item.withheld_reason))
    return Report(run_id=run_id, started_at=started.isoformat(timespec="seconds"), today=today.isoformat(),
                  since=since.isoformat(), prompt_version=PROMPT_VERSION, acts=[a.celex for a in acts],
                  items=rank(items), later_consolidations=later, failures=failures)
