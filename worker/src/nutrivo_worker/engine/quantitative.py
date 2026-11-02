"""Evaluators for character_height, threshold and additive_condition (docs/05 §Shapes, T-502, D05).

All three are deterministic and only read values that are stored: measured heights from the extraction (BE-17),
quantities and formula lines from the product, register rows from ref.feed_additives. A value that is not stored,
or not in the unit the rule names, is withheld (`data_missing`), never estimated, converted or assumed. The
choices that are not written down are the conservative ones and are asked on #52.

character_height
  params: `target`, `height_definition` (x_height · cap_height · figure_height), `bands` ([{quantity_from,
  quantity_to, quantity_unit, min_height_mm}]), `detect.term_keys` (register terms whose printed text is the target).
  The band is the one whose quantity range holds `facts["quantity"]` ({value, unit}); a single band open at both ends
  needs no quantity. Every target text object on the panel is measured; the rule fails when one is below the band
  minimum. A target read by OCR has no true scale and is withheld `no_true_scale`; figure_height has no stored
  measurement and is withheld `data_missing`. Judged on panels printed in one of the node's languages.
threshold
  params: `quantity`, `operator` (gt · ge · lt · le · eq), `value`, `unit`, `then`, `detect.term_keys` (what the
  consequence prints as). The quantity is `facts["quantities"][quantity]` ({value, unit}). Condition false: not
  applicable. Condition true: passed when the consequence is printed on the panel, failed when not.
additive_condition
  params: `check` (authorised_for_species · within_max_content · declaration_required), `additives` (identification
  numbers; absent means every additive of the formula), `species_wordings` ({species: [register species strings]}).
  Judged on each formula additive line it names; none: not applicable. Any failure fails the rule, any unknown
  withholds it."""
from __future__ import annotations

import datetime as dt
from typing import Any

from ..errors import SafeError
from .core import DATA_MISSING, RuleContext, RuleResult, TextLine, evaluator, find_printed, normalise

NO_TRUE_SCALE = "no_true_scale"
HEIGHT_DEFINITIONS = {"x_height": "x_height_mm", "cap_height": "cap_height_mm", "figure_height": None}
OPERATORS = {"gt": lambda a, b: a > b, "ge": lambda a, b: a >= b, "lt": lambda a, b: a < b,
             "le": lambda a, b: a <= b, "eq": lambda a, b: a == b}
ADDITIVE_CHECKS = ("authorised_for_species", "within_max_content", "declaration_required")


class InvalidParams(SafeError):
    """The rule's params are not of its shape: withheld as an evaluator error, never passed."""


def _withheld(reason: str = DATA_MISSING) -> RuleResult:
    return RuleResult("withheld", reason)


def _number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    return float(v)


def _term_keys(params: dict[str, Any]) -> list[str] | None:
    detect = params.get("detect")
    keys = detect.get("term_keys") if isinstance(detect, dict) else None
    if not isinstance(keys, list) or not keys or not all(isinstance(k, str) and k for k in keys):
        return None
    return keys


def _wordings(ctx: RuleContext, keys: list[str]) -> list[str]:
    lang = ctx.panel.language
    return [t for k in keys for t in ctx.terms.get((k, lang), ())] if lang else []


def _measure(value: Any) -> dict[str, Any] | None:
    """A stored {value, unit}, or None when it is not one."""
    if not isinstance(value, dict):
        return None
    v, unit = _number(value.get("value")), value.get("unit")
    return {"value": v, "unit": unit} if v is not None and isinstance(unit, str) and unit else None


def _same_unit(a: str, b: str) -> bool:
    return normalise(a) == normalise(b)


def _band(bands: Any, quantity: dict[str, Any] | None) -> dict[str, Any] | None:
    """The band whose range holds the quantity ([from, to), open where null); None when it cannot be told."""
    if not isinstance(bands, list) or not bands:
        return None
    for b in bands:
        if not isinstance(b, dict) or _number(b.get("min_height_mm")) is None:
            raise InvalidParams("a band needs min_height_mm")
    if len(bands) == 1 and bands[0].get("quantity_from") is None and bands[0].get("quantity_to") is None:
        return bands[0]
    if quantity is None:
        return None
    hits = []
    for b in bands:
        unit = b.get("quantity_unit")
        if not isinstance(unit, str) or not _same_unit(unit, quantity["unit"]):
            return None                       # never converted between units
        lo, hi = _number(b.get("quantity_from")), _number(b.get("quantity_to"))
        if (lo is None or quantity["value"] >= lo) and (hi is None or quantity["value"] < hi):
            hits.append(b)
    return hits[0] if len(hits) == 1 else None


def _targets(ctx: RuleContext, wordings: list[str]) -> list[TextLine]:
    wanted = [normalise(w) for w in wordings if w and w.strip()]
    return [line for line in ctx.panel.lines if any(w in normalise(line.text) for w in wanted)]


@evaluator("character_height")
def character_height(ctx: RuleContext) -> RuleResult:
    params = ctx.rule.params
    definition = params.get("height_definition")
    if definition is None:
        return _withheld()                  # the K02 extraction does not carry it; acceptance must add it
    if definition not in HEIGHT_DEFINITIONS:
        raise InvalidParams(f"{ctx.rule.rule_key}: unknown height_definition")
    keys = _term_keys(params)
    if keys is None:
        return _withheld()
    if not ctx.panel.language:
        return _withheld()
    if ctx.node.languages and ctx.panel.language not in ctx.node.languages:
        return RuleResult("not_applicable")
    band = _band(params.get("bands"), _measure(ctx.facts.get("quantity")))
    if band is None:
        return _withheld()
    required = float(band["min_height_mm"])
    wordings = _wordings(ctx, keys)
    if not wordings:
        return _withheld()
    targets = _targets(ctx, wordings)
    if not targets:
        return _withheld()                  # whether it is printed at all is a mandatory_particular rule's finding
    if any(t.is_ocr for t in targets):
        return _withheld(NO_TRUE_SCALE)     # OCR geometry has no physical scale: never estimated
    column = HEIGHT_DEFINITIONS[definition]
    if column is None:
        return _withheld()                  # figure height is not stored by the extraction: never estimated
    measured = [(getattr(t, column), t) for t in targets]
    if any(m is None or m <= 0 for m, _ in measured):
        return _withheld()
    low, line = min(measured, key=lambda x: x[0])
    common = {"text_object_id": line.id, "bbox_mm": line.bbox_mm, "measured_mm": round(float(low), 3),
              "required_mm": required, "height_definition": definition}
    if low < required:
        target = params.get("target") or ctx.rule.title
        return RuleResult("failed", message=f"{target}: {definition.replace('_', '-')} {low:.2f} mm, below the "
                                            f"{required:g} mm minimum.", **common)
    return RuleResult("passed", **common)


@evaluator("threshold")
def threshold(ctx: RuleContext) -> RuleResult:
    params = ctx.rule.params
    op, value, unit, quantity = (params.get("operator"), _number(params.get("value")), params.get("unit"),
                                 params.get("quantity"))
    if op is None or value is None or not isinstance(unit, str) or not isinstance(quantity, str) or not quantity:
        return _withheld()
    if op not in OPERATORS:
        raise InvalidParams(f"{ctx.rule.rule_key}: unknown operator")
    keys = _term_keys(params)
    if keys is None:
        return _withheld()
    quantities = ctx.facts.get("quantities")
    measured = _measure(quantities.get(quantity)) if isinstance(quantities, dict) else None
    if measured is None or not _same_unit(measured["unit"], unit):
        return _withheld()                  # never converted between units, never assumed
    if not OPERATORS[op](measured["value"], value):
        return RuleResult("not_applicable")
    if not ctx.panel.language:
        return _withheld()
    if ctx.node.languages and ctx.panel.language not in ctx.node.languages:
        return RuleResult("not_applicable")
    wordings = _wordings(ctx, keys)
    if not wordings:
        return _withheld()
    found, line = find_printed(ctx.panel, wordings)
    if found:
        return RuleResult("passed", text_object_id=line.id if line else None, bbox_mm=line.bbox_mm if line else None)
    then = params.get("then") or ctx.rule.title
    return RuleResult("failed", message=f"{then}: required at {quantity} {measured['value']:g} {unit}, "
                                        f"not found on the {ctx.panel.language} panel.")


def _additive_outcome(check: str, line: dict[str, Any], params: dict[str, Any], facts: dict[str, Any],
                      today: dt.date) -> str:
    """passed · failed · unknown for one formula additive line."""
    reg = line.get("register")
    if not isinstance(reg, dict):
        return "unknown"
    if check == "authorised_for_species":
        expiry = reg.get("expiry")
        if isinstance(expiry, str):
            expiry = dt.date.fromisoformat(expiry)
        if isinstance(expiry, dt.date) and expiry < today:
            return "failed"
        species, table = facts.get("species"), params.get("species_wordings")
        allowed = table.get(species) if isinstance(table, dict) and species else None
        printed = reg.get("species")
        if not isinstance(allowed, list) or not isinstance(printed, list):
            return "unknown"
        wanted = {normalise(a) for a in allowed if isinstance(a, str)}
        # the register's species strings are unsplit: only an exact match proves authorisation, a miss proves nothing
        return "passed" if any(isinstance(p, str) and normalise(p) in wanted for p in printed) else "unknown"
    if check == "within_max_content":
        limit, amount = _measure(reg.get("max_content")), _number(line.get("amount"))
        unit = line.get("unit")
        if limit is None or amount is None or not isinstance(unit, str) or not _same_unit(unit, limit["unit"]):
            return "unknown"
        return "passed" if amount <= limit["value"] else "failed"
    return "unknown"                        # declaration_required: no per-language declaration source yet (#52)


@evaluator("additive_condition")
def additive_condition(ctx: RuleContext) -> RuleResult:
    params = ctx.rule.params
    check = params.get("check")
    if check is None:
        return _withheld()
    if check not in ADDITIVE_CHECKS:
        raise InvalidParams(f"{ctx.rule.rule_key}: unknown check")
    named = params.get("additives")
    if named is not None and (not isinstance(named, list) or not all(isinstance(a, str) for a in named)):
        raise InvalidParams(f"{ctx.rule.rule_key}: additives are not a list of identification numbers")
    formula = ctx.facts.get("additives")
    if not isinstance(formula, list):
        return _withheld()
    lines = [x for x in formula if isinstance(x, dict) and (named is None or x.get("additive_ref") in named)]
    if not lines:
        return RuleResult("not_applicable")
    today = ctx.facts.get("today") or dt.date.today()
    outcomes = {(x.get("additive_ref"), _additive_outcome(check, x, params, ctx.facts, today)) for x in lines}
    failed = sorted(str(ref) for ref, o in outcomes if o == "failed")
    if failed:
        return RuleResult("failed", message=f"{ctx.rule.title}: {', '.join(failed)} ({check.replace('_', ' ')}).")
    if any(o == "unknown" for _, o in outcomes):
        return _withheld()
    return RuleResult("passed")


__all__ = ["NO_TRUE_SCALE", "additive_condition", "character_height", "threshold"]
