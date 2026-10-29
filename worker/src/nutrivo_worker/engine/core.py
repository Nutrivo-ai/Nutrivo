"""Evaluating one check: a node × language panel against the pinned ruleset (docs/05 §Evaluating one check).

1. Coverage first: every domain of the node that is not complete gives a not_assessed finding with its gap_id.
2. Member rules held on the node or its region are selected by applicability (three-valued: unknown is withheld
   with `data_missing`, never applied or skipped by default).
3. On a panel that is not assessable, every rule that reads panel text is withheld with the panel's failure code.
4. Each remaining rule runs its shape's evaluator: passed (no finding), failed (an `action` finding) or withheld
   (a `not_assessed` finding with a reason code). A shape without an evaluator is withheld `evaluator_missing`; an
   evaluator fault is withheld `evaluator_error` and reported; a model error is withheld with its own reason
   (`model_unavailable`, `model_refused`, ...). Nothing passes by default (BE-21).
5. label_state: action if anything failed; else not_assessed if anything was withheld, any domain is incomplete or
   nothing applied; else clear. The database refuses clear where coverage is incomplete (private.verdict_guard).

Evaluators judge the printed text of the panel in its own language only (BE-22): they never translate, and the terms
they look for are the accepted term register entries for that language."""
from __future__ import annotations

import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import sentry_sdk

from ..errors import ModelError
from ..logs import get_logger, kv
from . import applicability

log = get_logger(__name__)

RuleOutcome = Literal["passed", "failed", "withheld", "not_applicable"]
LabelState = Literal["clear", "action", "not_assessed"]

# Reason codes the engine itself gives (docs/03 §Vocabularies, withheld reason_code).
DATA_MISSING = "data_missing"
EVALUATOR_MISSING = "evaluator_missing"
EVALUATOR_ERROR = "evaluator_error"
NOT_APPLICABLE = "not_applicable"     # only reported by the fixtures adapter; never written as a finding

# Every shape reads printed panel text today, so a not-assessable panel withholds them all.
PANEL_TEXT_SHAPES = frozenset({"threshold", "mandatory_particular", "prescribed_wording", "character_height",
                               "additive_condition", "claim_judgement"})


@dataclass(frozen=True)
class Rule:
    rule_key: str
    version: int
    shape: str
    domain: str
    node_id: str
    title: str
    params: dict[str, Any]
    applicability: dict[str, Any]
    article_ref: str


@dataclass(frozen=True)
class TextLine:
    text: str
    id: str | None = None
    bbox_mm: list[float] | None = None


@dataclass(frozen=True)
class Panel:
    index: int
    language: str | None                 # None when the extraction could not tell ('und')
    status: Literal["extracted", "not_assessable"]
    failure_code: str | None = None
    lines: tuple[TextLine, ...] = ()
    id: str | None = None

    @property
    def assessable(self) -> bool:
        return self.status == "extracted" and self.failure_code is None


@dataclass(frozen=True)
class Coverage:
    domain: str
    state: str
    gap_id: str | None
    reason_code: str | None


@dataclass(frozen=True)
class Node:
    id: str
    languages: tuple[str, ...]
    region: str | None


@dataclass
class RuleContext:
    """What an evaluator may read. `terms[(term_key, language)]` holds the accepted register entries."""

    rule: Rule
    panel: Panel
    panels: tuple[Panel, ...]
    node: Node
    terms: dict[tuple[str, str], tuple[str, ...]]
    facts: dict[str, Any]
    models: Any = None
    workspace_id: str | None = None
    model_store: Any = None


@dataclass
class RuleResult:
    outcome: RuleOutcome
    reason: str | None = None
    message: str | None = None
    provenance: str = "deterministic_rule"
    text_object_id: str | None = None
    bbox_mm: list[float] | None = None
    confidence: float | None = None
    model_call_id: str | None = None


Evaluator = Callable[[RuleContext], RuleResult]
EVALUATORS: dict[str, Evaluator] = {}


def evaluator(shape: str) -> Callable[[Evaluator], Evaluator]:
    def decorator(fn: Evaluator) -> Evaluator:
        EVALUATORS[shape] = fn
        return fn
    return decorator


@dataclass
class CheckResult:
    node_id: str
    panel: Panel
    label_state: LabelState
    applied: list[str] = field(default_factory=list)
    passed: list[str] = field(default_factory=list)
    withheld: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    @property
    def open_actions(self) -> int:
        return sum(1 for f in self.findings if f["state"] == "action")


def normalise(text: str, *, fold: bool = True) -> str:
    """NFC, whitespace collapsed, and case-folded unless an exact match is asked for."""
    out = " ".join(unicodedata.normalize("NFC", text).split())
    return out.casefold() if fold else out


def find_printed(panel: Panel, wordings: list[str], *, fold: bool = True) -> tuple[bool, TextLine | None]:
    """Whether one of the wordings is printed on the panel: in one text object (returned, for its pin), or across
    the panel's lines in reading order."""
    wanted = [normalise(w, fold=fold) for w in wordings if w and w.strip()]
    if not wanted:
        return False, None
    for line in panel.lines:
        got = normalise(line.text, fold=fold)
        if any(w in got for w in wanted):
            return True, line
    joined = normalise(" ".join(line.text for line in panel.lines), fold=fold)
    return any(w in joined for w in wanted), None


def facts_for(base: dict[str, Any], node: Node, panel: Panel) -> dict[str, Any]:
    return {**base, "node_id": node.id, "region": node.region, "panel_language": panel.language}


def evaluate_rule(ctx: RuleContext) -> RuleResult:
    rule = ctx.rule
    try:
        applies = applicability.evaluate(rule.applicability, ctx.facts)
    except applicability.InvalidPredicate as exc:
        sentry_sdk.capture_exception(exc)
        return RuleResult("withheld", EVALUATOR_ERROR)
    if applies is False:
        return RuleResult("not_applicable", NOT_APPLICABLE)
    if applies == applicability.UNKNOWN:
        return RuleResult("withheld", DATA_MISSING)
    if rule.shape in PANEL_TEXT_SHAPES and not ctx.panel.assessable:
        return RuleResult("withheld", ctx.panel.failure_code or DATA_MISSING)
    fn = EVALUATORS.get(rule.shape)
    if fn is None:
        return RuleResult("withheld", EVALUATOR_MISSING)
    try:
        result = fn(ctx)
    except ModelError as exc:
        return RuleResult("withheld", exc.reason)
    except Exception as exc:  # noqa: BLE001  an evaluator fault is a withhold with a reason, never a pass
        sentry_sdk.capture_exception(exc)
        log.warning("evaluator failed", extra=kv(rule_key=rule.rule_key, shape=rule.shape,
                                                 error=type(exc).__name__))
        return RuleResult("withheld", EVALUATOR_ERROR)
    if result.outcome == "withheld" and not result.reason:
        result.reason = DATA_MISSING
    return result


def _withheld_message(reason: str) -> str:
    return f"Not assessed ({reason})."


def evaluate_check(node: Node, panel: Panel, panels: tuple[Panel, ...], rules: list[Rule],
                   coverage: list[Coverage], terms: dict[tuple[str, str], tuple[str, ...]],
                   base_facts: dict[str, Any], *, models: Any = None, workspace_id: str | None = None,
                   model_store: Any = None) -> CheckResult:
    """One node × panel. `rules` are the ruleset's members held on the node or its region."""
    result = CheckResult(node.id, panel, "not_assessed")
    common = {"panel_id": panel.id, "language": panel.language}
    incomplete = False
    for c in coverage:
        if c.state != "complete":
            incomplete = True
            result.findings.append({**common, "rule_key": None, "rule_version": None, "gap_id": c.gap_id,
                                    "state": "not_assessed", "provenance": "not_assessed",
                                    "reason_code": c.reason_code or ("partially_encoded" if c.state == "partial"
                                                                     else "not_encoded"),
                                    "message": _withheld_message(c.domain), "citation": None})
    facts = facts_for(base_facts, node, panel)
    failed = False
    for rule in sorted(rules, key=lambda r: r.rule_key):
        ctx = RuleContext(rule, panel, panels, node, terms, facts, models, workspace_id, model_store)
        r = evaluate_rule(ctx)
        if r.outcome == "not_applicable":
            continue
        base = {**common, "rule_key": rule.rule_key, "rule_version": rule.version, "gap_id": None,
                "citation": rule.article_ref}
        if r.outcome == "withheld":
            result.withheld.append(rule.rule_key)
            result.findings.append({**base, "state": "not_assessed", "provenance": "not_assessed",
                                    "reason_code": r.reason, "message": _withheld_message(r.reason or DATA_MISSING)})
            continue
        result.applied.append(rule.rule_key)
        if r.outcome == "passed":
            result.passed.append(rule.rule_key)
            continue
        failed = True
        result.findings.append({**base, "state": "action", "provenance": r.provenance, "reason_code": None,
                                "message": r.message or f"{rule.title}: not as required.",
                                "text_object_id": r.text_object_id, "bbox_mm": r.bbox_mm,
                                "confidence": r.confidence, "model_call_id": r.model_call_id})
    if failed:
        result.label_state = "action"
    elif result.withheld or incomplete or not coverage or not result.applied:
        result.label_state = "not_assessed"
    else:
        result.label_state = "clear"
    return result


def worst(states: list[LabelState]) -> LabelState:
    """A market's label state over its panels: action, then not_assessed, then clear."""
    if "action" in states:
        return "action"
    if not states or "not_assessed" in states:
        return "not_assessed"
    return "clear"
