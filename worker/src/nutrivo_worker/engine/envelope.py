"""The compliance envelope of a brief (E02, docs/05 §The envelope): per market × language, what the product must
carry, may say and must stay within, from the accepted rules of the pinned ruleset only. Nothing is judged on
artwork (a brief has none): the envelope states the rules' requirements in the register's own wording, and judges
only the formula, deterministically.

The same honesty as a check (D04, E02.must.1):
- every coverage domain that is not complete gives a `not_assessed` item with its gap_id and reason;
- a rule whose applicability is unknown, whose params or term links are missing, or with no register term in the
  language is withheld `data_missing`, never filled from other wording or translated (D-31, non-negotiable 4);
- a shape without an envelope reading is withheld `evaluator_missing`; a fault is withheld `evaluator_error`;
- claim rules are withheld `claim_not_evaluated` and no model is called: the model never decides coverage, authors a
  rule or gives an envelope item (non-negotiable 6; #209 Q1 decides where a harness threshold comes from).
A market is `clear` only when all six domains are complete, nothing was withheld and something was answered;
private.envelope_verdict_guard refuses anything else (P0021).

Nutrient adequacy is out of scope until FEDIAF is licensed (E02.must.2, D-10): no rule reads a nutrient level for
adequacy, formula percentages are never judged, and every envelope records `nutrient_adequacy` in OUT_OF_SCOPE.

Item kinds (app.envelope_items.kind) by shape:
  mandatory_particular → requirement   {title, wordings, scope}
  prescribed_wording   → permitted     {title, wordings, match}
  threshold            → obligation    {title, quantity, operator, value, unit, then, wordings}
  character_height     → requirement   {title, height_definition, bands, wordings}
  additive_condition   → per formula additive line it names:
      within_max_content     → limit  {additive_ref, ingredient, amount, unit, max_content, outcome within|exceeds}
      authorised_for_species → permitted (authorised) or prohibited (authorisation expired) {additive_ref, ...}
      unknown                → not_assessed data_missing {additive_ref}
Wordings are the accepted term register entries of the item's language, never source text and never translated."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Literal

import sentry_sdk

from ..logs import get_logger, kv
from . import applicability
from .claims import CLAIM_NOT_EVALUATED
from .core import COVERAGE_DOMAINS, DATA_MISSING, EVALUATOR_ERROR, EVALUATOR_MISSING, Coverage, Node, Rule
from .quantitative import ADDITIVE_CHECKS, OPERATORS, _additive_outcome, _measure, _number

log = get_logger(__name__)

NodeState = Literal["clear", "action", "not_assessed"]
OUT_OF_SCOPE = ("nutrient_adequacy",)     # E02.must.2: until FEDIAF is licensed (D-10)
LANGUAGE_FREE_SHAPES = frozenset({"additive_condition"})   # judged on the formula, once per market


class _Withhold(Exception):
    def __init__(self, reason: str = DATA_MISSING, payload: dict[str, Any] | None = None):
        super().__init__(reason)
        self.reason = reason
        self.payload = payload or {}


@dataclass
class NodeEnvelope:
    node_id: str
    state: NodeState = "not_assessed"
    items: list[dict[str, Any]] = field(default_factory=list)

    @property
    def withheld(self) -> int:
        return sum(1 for i in self.items if i["kind"] == "not_assessed")

    @property
    def open_items(self) -> int:
        return sum(1 for i in self.items if _is_action(i))


def _is_action(item: dict[str, Any]) -> bool:
    return item["kind"] == "prohibited" or (item["kind"] == "limit" and item["payload"].get("outcome") == "exceeds")


def _keys(value: Any) -> list[str] | None:
    if not isinstance(value, list) or not value or not all(isinstance(k, str) and k for k in value):
        return None
    return value


def _wordings(terms: dict[tuple[str, str], tuple[str, ...]], keys: list[str], language: str | None) -> list[str]:
    if not language:
        raise _Withhold()
    out = [t for k in keys for t in terms.get((k, language), ())]
    if not out:
        raise _Withhold()                    # no accepted term in this language: never another language's wording
    return list(dict.fromkeys(out))


def _detect(params: dict[str, Any]) -> list[str]:
    detect = params.get("detect")
    keys = _keys(detect.get("term_keys")) if isinstance(detect, dict) else None
    if keys is None:
        raise _Withhold()
    return keys


def _language_items(rule: Rule, language: str | None, terms: dict[tuple[str, str], tuple[str, ...]]
                    ) -> list[tuple[str, dict[str, Any]]]:
    """(kind, payload) for a language-bound shape in one language; raises _Withhold."""
    p = rule.params
    if rule.shape == "mandatory_particular":
        scope = p.get("scope", "each_panel_in_node_language")
        if scope not in ("each_panel_in_node_language", "any_panel"):
            raise _Withhold(EVALUATOR_ERROR)
        return [("requirement", {"title": rule.title, "wordings": _wordings(terms, _detect(p), language),
                                 "scope": scope})]
    if rule.shape == "prescribed_wording":
        key, alts = p.get("term_key"), p.get("alternative_term_keys") or []
        match = p.get("match", "case_folded")
        if not isinstance(key, str) or not key or not isinstance(alts, list):
            raise _Withhold()
        if match not in ("case_folded", "exact"):
            raise _Withhold(EVALUATOR_ERROR)
        return [("permitted", {"title": rule.title, "wordings": _wordings(terms, [key, *alts], language),
                               "match": match})]
    if rule.shape == "threshold":
        op, value, unit, quantity = p.get("operator"), _number(p.get("value")), p.get("unit"), p.get("quantity")
        if op is None or value is None or not isinstance(unit, str) or not isinstance(quantity, str) or not quantity:
            raise _Withhold()
        if op not in OPERATORS:
            raise _Withhold(EVALUATOR_ERROR)
        return [("obligation", {"title": rule.title, "quantity": quantity, "operator": op, "value": value,
                                "unit": unit, "then": p.get("then"),
                                "wordings": _wordings(terms, _detect(p), language)})]
    if rule.shape == "character_height":
        definition, bands = p.get("height_definition"), p.get("bands")
        if definition not in ("x_height", "cap_height", "figure_height") or not isinstance(bands, list) or not bands:
            raise _Withhold()
        return [("requirement", {"title": rule.title, "height_definition": definition, "bands": bands,
                                 "wordings": _wordings(terms, _detect(p), language)})]
    if rule.shape == "claim_judgement":
        raise _Withhold(CLAIM_NOT_EVALUATED)  # no harness threshold source yet: no model call (#209 Q1)
    raise _Withhold(EVALUATOR_MISSING)


def _additive_items(rule: Rule, facts: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """(kind, payload) per formula additive line the rule names; a line that cannot be judged is ("not_assessed",
    payload with its reason). Raises _Withhold for the whole rule."""
    p = rule.params
    check = p.get("check")
    if check is None:
        raise _Withhold()
    if check not in ADDITIVE_CHECKS:
        raise _Withhold(EVALUATOR_ERROR)
    named = p.get("additives")
    if named is not None and (not isinstance(named, list) or not all(isinstance(a, str) for a in named)):
        raise _Withhold(EVALUATOR_ERROR)
    formula = facts.get("additives")
    if not isinstance(formula, list):
        raise _Withhold()                    # no formula, or a line not matched to the register (#172, #76)
    today = facts.get("today") or dt.date.today()
    out: list[tuple[str, dict[str, Any]]] = []
    for line in formula:
        if not isinstance(line, dict) or (named is not None and line.get("additive_ref") not in named):
            continue
        base = {"title": rule.title, "check": check, "additive_ref": line.get("additive_ref"),
                "ingredient": line.get("ingredient")}
        outcome = _additive_outcome(check, line, p, facts, today)
        if outcome == "unknown":
            out.append(("not_assessed", {**base, "reason_code": DATA_MISSING}))
        elif check == "within_max_content":
            limit = _measure((line.get("register") or {}).get("max_content"))
            out.append(("limit", {**base, "amount": _number(line.get("amount")), "unit": line.get("unit"),
                                  "max_content": limit,
                                  "outcome": "within" if outcome == "passed" else "exceeds"}))
        else:                                # authorised_for_species
            out.append(("permitted" if outcome == "passed" else "prohibited",
                        {**base, "species": facts.get("species")}))
    return out


def _item(node: Node, rule: Rule | None, language: str | None, kind: str, payload: dict[str, Any], *,
          reason: str | None = None, gap_id: str | None = None) -> dict[str, Any]:
    withheld = kind == "not_assessed"
    return {"node_id": node.id, "language": language, "kind": kind,
            "rule_key": rule.rule_key if rule else None, "rule_version": rule.version if rule else None,
            "gap_id": gap_id, "provenance": "not_assessed" if withheld else "deterministic_rule",
            "reason_code": (reason or DATA_MISSING) if withheld else None,
            "citation": rule.article_ref if rule else None, "payload": payload}


def _rule_items(node: Node, rule: Rule, language: str | None, terms: dict[tuple[str, str], tuple[str, ...]],
                facts: dict[str, Any]) -> list[dict[str, Any]]:
    f = {**facts, "node_id": node.id, "region": node.region, "panel_language": language}
    try:
        applies = applicability.evaluate(rule.applicability, f)
    except applicability.InvalidPredicate as exc:
        sentry_sdk.capture_exception(exc)
        return [_item(node, rule, language, "not_assessed", {"title": rule.title}, reason=EVALUATOR_ERROR)]
    if applies is False:
        return []
    if applies == applicability.UNKNOWN:
        return [_item(node, rule, language, "not_assessed", {"title": rule.title}, reason=DATA_MISSING)]
    try:
        if rule.shape in LANGUAGE_FREE_SHAPES:
            pairs = _additive_items(rule, f)
        else:
            pairs = _language_items(rule, language, terms)
    except _Withhold as w:
        return [_item(node, rule, language, "not_assessed", {"title": rule.title, **w.payload}, reason=w.reason)]
    except Exception as exc:  # noqa: BLE001  a fault is a withhold with a reason, never an answer
        sentry_sdk.capture_exception(exc)
        log.warning("envelope rule failed", extra=kv(rule_key=rule.rule_key, shape=rule.shape,
                                                     error=type(exc).__name__))
        return [_item(node, rule, language, "not_assessed", {"title": rule.title}, reason=EVALUATOR_ERROR)]
    return [_item(node, rule, language, kind, {k: v for k, v in payload.items() if k != "reason_code"},
                  reason=payload.get("reason_code")) for kind, payload in pairs]


def build_node(node: Node, rules: list[Rule], coverage: list[Coverage],
               terms: dict[tuple[str, str], tuple[str, ...]], facts: dict[str, Any]) -> NodeEnvelope:
    """One market's envelope from the pinned ruleset's members held on the node or its region."""
    env = NodeEnvelope(node.id)
    incomplete = False
    for c in coverage:
        if c.state != "complete":
            incomplete = True
            env.items.append(_item(node, None, None, "not_assessed", {"domain": c.domain},
                                   reason=c.reason_code or ("partially_encoded" if c.state == "partial"
                                                            else "not_encoded"), gap_id=c.gap_id))
    # A domain with no coverage row is not encoded: the market is not_assessed, with no invented gap (#179 DB-1).
    if not {c.domain for c in coverage}.issuperset(COVERAGE_DOMAINS):
        incomplete = True
    languages: tuple[str | None, ...] = node.languages or (None,)
    for rule in sorted(rules, key=lambda r: r.rule_key):
        for language in ((None,) if rule.shape in LANGUAGE_FREE_SHAPES else languages):
            env.items.extend(_rule_items(node, rule, language, terms, facts))
    answered = any(i["kind"] != "not_assessed" for i in env.items)
    if any(_is_action(i) for i in env.items):
        env.state = "action"
    elif incomplete or env.withheld or not answered:
        env.state = "not_assessed"
    else:
        env.state = "clear"
    return env


__all__ = ["OUT_OF_SCOPE", "NodeEnvelope", "build_node"]
