"""D03 (T-402): the model's classification suggestion, from the printed label text, for a person to confirm.

- **One model call** through `nutrivo_worker.models` (purpose `classification`, prompt `classification.v1`): a row in
  app.model_calls, a Langfuse generation inside the job trace, cassettes in CI (MODELS_MODE=replay).
- **Unsure fields stay empty (D03.fail.1).** A field keeps its value only when the model did not abstain, its
  confidence is at least MIN_CONFIDENCE, the value is one of the field's allowed values and its quote is printed,
  verbatim, on the panel it names. Anything else is null for the person to fill; a model error leaves every field null
  and writes no row. Nothing is ever guessed.
- **The citation is label evidence only**: per field, the quoted printed string with its panel and language. The model
  is never asked for, and never stores, a legal reference (CLAUDE.md non-negotiables 6 and 7).
- **Stored unconfirmed.** One insert-only app.classifications row, provenance `model_judgement`, `confirmed_by` null,
  `model_call_id` set. The engine counts an unconfirmed classification as missing (docs/05), so no rule uses a
  suggestion before a person confirms it (BE-19, D03.must.1).
- **Never over a person's answer.** No suggestion is written while the product's latest classification is confirmed:
  a new revision keeps the person's classification until a person changes it.
- **Idempotent** per extraction run: the run id is in the citation, and a second attempt finds the row.

The allowed values are provisional: no vocabulary for species, life stage, intended use or PARNUT status is written
down yet (question Q3 on #44). `product_class` uses the column's own check constraint."""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

import psycopg
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict

from . import models
from .errors import ModelError
from .logs import get_logger, kv

log = get_logger(__name__)

PROMPT_VERSION = "v1"
MIN_CONFIDENCE = 0.7            # below this a field is left for the person (D03.fail.1)
MAX_PANELS = 12
MAX_PANEL_CHARS = 4000
FIELDS = ("species", "life_stage", "product_class", "intended_use", "parnut_status")

# Provisional closed vocabularies (Q3 on #44). product_class is app.classifications' own check constraint.
ALLOWED: dict[str, tuple[str, ...]] = {
    "species": ("dog", "cat"),
    "life_stage": ("growth", "adult", "senior"),
    "product_class": ("complete", "complementary", "treat", "mineral", "dietetic", "other"),
    "intended_use": (),                     # no vocabulary yet: always left for the person
    "parnut_status": ("parnut",),           # only ever positive, from a printed declaration
}


class _Field(BaseModel):
    model_config = ConfigDict(extra="forbid")
    abstain: bool
    confidence: float           # 0..1, checked in guard(): structured outputs refuse number bounds
    quote: str | None
    panel_index: int | None


class SpeciesField(_Field):
    value: Literal["dog", "cat"] | None


class LifeStageField(_Field):
    value: Literal["growth", "adult", "senior"] | None


class ProductClassField(_Field):
    value: Literal["complete", "complementary", "treat", "mineral", "dietetic", "other"] | None


class IntendedUseField(_Field):
    value: None


class ParnutField(_Field):
    value: Literal["parnut"] | None


class ClassificationSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    species: SpeciesField
    life_stage: LifeStageField
    product_class: ProductClassField
    intended_use: IntendedUseField
    parnut_status: ParnutField


@dataclass(frozen=True)
class PanelText:
    index: int
    language: str | None
    text: str


@dataclass(frozen=True)
class Suggestion:
    values: dict[str, str | None]
    cites: dict[str, dict[str, Any]]
    reasons: dict[str, str]                 # why each empty field is empty: abstained, low_confidence, …

    @property
    def filled(self) -> int:
        return sum(v is not None for v in self.values.values())


def normalise(s: str) -> str:
    """NFC with whitespace collapsed: the engine's own matching (docs/05)."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s)).strip()


def model_inputs(panels: list[PanelText]) -> dict[str, Any]:
    return {"panels": [{"panel_index": p.index, "language": p.language, "text": p.text[:MAX_PANEL_CHARS]}
                       for p in panels[:MAX_PANELS]]}


def guard(out: ClassificationSuggestion, panels: list[PanelText]) -> Suggestion:
    """Keep a field only when it is sure and evidenced on the label; everything else is left empty (D03.fail.1)."""
    by_index = {p.index: p for p in panels[:MAX_PANELS]}
    values: dict[str, str | None] = {}
    cites: dict[str, dict[str, Any]] = {}
    reasons: dict[str, str] = {}
    for name in FIELDS:
        f = getattr(out, name)
        values[name] = None
        if f.abstain or f.value is None:
            reasons[name] = "abstained"
        elif f.value not in ALLOWED[name]:
            reasons[name] = "value_not_allowed"
        elif not MIN_CONFIDENCE <= f.confidence <= 1:
            reasons[name] = "low_confidence"
        elif not f.quote or f.panel_index not in by_index:
            reasons[name] = "no_evidence"
        elif normalise(f.quote) not in normalise(by_index[f.panel_index].text[:MAX_PANEL_CHARS]) \
                or not normalise(f.quote):
            reasons[name] = "quote_not_on_label"
        else:
            values[name] = f.value
            p = by_index[f.panel_index]
            cites[name] = {"quote": normalise(f.quote), "panel_index": p.index, "language": p.language,
                           "confidence": f.confidence}
    return Suggestion(values, cites, reasons)


class _CaptureCallId:
    """Passes the app.model_calls row to the store and keeps its id for app.classifications.model_call_id."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.id: str | None = None

    def insert_model_call(self, row: dict[str, Any]) -> None:
        r = self.conn.execute(
            """insert into app.model_calls (workspace_id, purpose, provider, model_id, prompt_version, input_hash,
                                            output, input_tokens, output_tokens, cost_eur, latency_ms)
               values (%(workspace_id)s, %(purpose)s, %(provider)s, %(model_id)s, %(prompt_version)s,
                       %(input_hash)s, %(output)s, %(input_tokens)s, %(output_tokens)s, %(cost_eur)s,
                       %(latency_ms)s) returning id""",
            {**row, "output": Jsonb(row.get("output"))}).fetchone()
        self.id = str(r["id"])


def suggest(panels: list[PanelText], *, workspace_id: str | None = None,
            store: Any = None) -> tuple[Suggestion, str | None]:
    """One model call; returns the guarded suggestion and a withheld reason (None when the model answered)."""
    if not panels:
        return Suggestion({f: None for f in FIELDS}, {}, {f: "no_label_text" for f in FIELDS}), "no_label_text"
    try:
        out = models.call("classification", PROMPT_VERSION, model_inputs(panels), ClassificationSuggestion,
                          workspace_id=workspace_id, store=store, max_tokens=2048)
    except ModelError as exc:
        return Suggestion({f: None for f in FIELDS}, {}, {f: exc.reason for f in FIELDS}), exc.reason
    return guard(out, panels), None


# ── Postgres ─────────────────────────────────────────────────────────────────────────────────────────
class PgClassificationStore:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def latest(self, product_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select id, confirmed_at from app.classifications where product_id = %s
                order by created_at desc, id desc limit 1""", (product_id,)).fetchone()

    def for_run(self, product_id: str, run_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select id from app.classifications where product_id = %s and provenance = 'model_judgement'
                 and citation::jsonb ->> 'extraction_run_id' = %s limit 1""", (product_id, run_id)).fetchone()

    def panels(self, run_id: str) -> list[PanelText]:
        rows = self.conn.execute(
            """select p.panel_index, p.language, string_agg(t.text, E'\n' order by t.reading_order) as text
                 from app.artwork_panels p join app.text_objects t on t.panel_id = p.id
                where p.extraction_run_id = %s and p.status = 'extracted'
                group by p.panel_index, p.language order by p.panel_index""", (run_id,)).fetchall()
        return [PanelText(r["panel_index"], r["language"], r["text"] or "") for r in rows if r["text"]]

    def insert(self, workspace_id: str, product_id: str, artwork_version_id: str, run_id: str, s: Suggestion,
               model_call_id: str | None) -> str:
        citation = {"basis": "label_text", "artwork_version_id": artwork_version_id, "extraction_run_id": run_id,
                    "prompt_version": f"classification.{PROMPT_VERSION}", "fields": s.cites, "empty": s.reasons}
        r = self.conn.execute(
            """insert into app.classifications (workspace_id, product_id, species, life_stage, product_class,
                                                intended_use, parnut_status, citation, provenance, model_call_id)
               values (%s, %s, %s, %s, %s, %s, %s, %s, 'model_judgement', %s) returning id""",
            (workspace_id, product_id, s.values["species"], s.values["life_stage"], s.values["product_class"],
             s.values["intended_use"], s.values["parnut_status"], json.dumps(citation, ensure_ascii=False,
                                                                              sort_keys=True),
             model_call_id)).fetchone()
        return str(r["id"])


def suggest_for_run(conn: psycopg.Connection, workspace_id: str, product_id: str, artwork_version_id: str,
                    run_id: str) -> dict[str, Any]:
    """After an extraction: write the suggestion once per run. Returns the progress entry (ids and codes only)."""
    store = PgClassificationStore(conn)
    done = store.for_run(product_id, run_id)
    if done is not None:
        return {"outcome": "already_suggested", "classification_id": str(done["id"])}
    latest = store.latest(product_id)
    if latest is not None and latest["confirmed_at"] is not None:
        return {"outcome": "skipped_confirmed", "classification_id": str(latest["id"])}
    panels = store.panels(run_id)
    capture = _CaptureCallId(conn)
    s, withheld = suggest(panels, workspace_id=workspace_id, store=capture)
    if withheld is not None:
        log.info("classification withheld", extra=kv(product_id=product_id, extraction_run_id=run_id,
                                                     reason=withheld))
        return {"outcome": "withheld", "reason": withheld}
    cid = store.insert(workspace_id, product_id, artwork_version_id, run_id, s, capture.id)
    log.info("classification suggested", extra=kv(product_id=product_id, classification_id=cid, filled=s.filled))
    return {"outcome": "suggested", "classification_id": cid, "filled": s.filled}
