"""Evaluators for mandatory_particular and prescribed_wording (docs/05 §Shapes), and their registration in the
fixtures runner. Both are deterministic and judge only the printed text of the panel, in the panel's own language,
against the accepted term register entries for that language (BE-11, BE-22). Nothing is translated, and a value the
rule or the register does not give is withheld with `data_missing`, never assumed.

mandatory_particular
  params: `particular`, `detect.term_keys` (term register keys whose printed term shows the particular is present),
  `scope`: `each_panel_in_node_language` (default: judged on each panel printed in one of the node's languages; not
  applicable on other panels) or `any_panel` (present when printed on any panel of the artwork, each in its own
  language). Failed when no term is printed.
prescribed_wording
  params: `term_key`, `alternatives` (a list, or a map of language to list, of wordings also permitted), `match`:
  `case_folded` (default) or `exact`. Judged on each panel printed in one of the node's languages (not applicable on
  other panels). Failed when neither the register entry for the panel's language nor an alternative is printed.
Matching is on NFC text with whitespace collapsed."""
from __future__ import annotations

from typing import Any

from .. import fixtures_runner as fr
from ..errors import SafeError
from .core import (
    DATA_MISSING,
    Coverage,
    Node,
    Panel,
    Rule,
    RuleContext,
    RuleResult,
    TextLine,
    evaluate_rule,
    evaluator,
    facts_for,
    find_printed,
)

SCOPES = ("each_panel_in_node_language", "any_panel")
MATCHES = ("case_folded", "exact")


class InvalidParams(SafeError):
    """The rule's params are not of its shape: withheld as an evaluator error, never passed."""


def _withheld(reason: str = DATA_MISSING) -> RuleResult:
    return RuleResult("withheld", reason)


def _terms(ctx: RuleContext, keys: list[str], language: str | None) -> list[str]:
    if not language:
        return []
    return [t for k in keys for t in ctx.terms.get((k, language), ())]


def _passed(line: TextLine | None) -> RuleResult:
    return RuleResult("passed", text_object_id=line.id if line else None, bbox_mm=line.bbox_mm if line else None)


@evaluator("mandatory_particular")
def mandatory_particular(ctx: RuleContext) -> RuleResult:
    params = ctx.rule.params
    detect = params.get("detect")
    keys = detect.get("term_keys") if isinstance(detect, dict) else None
    if not isinstance(keys, list) or not keys or not all(isinstance(k, str) for k in keys):
        return _withheld()
    scope = params.get("scope", SCOPES[0])
    if scope not in SCOPES:
        raise InvalidParams(f"{ctx.rule.rule_key}: unknown scope")
    particular = params.get("particular") or ctx.rule.title
    failed = RuleResult("failed", message=f"{particular}: not found on the {ctx.panel.language} panel.")
    if scope == "each_panel_in_node_language":
        if not ctx.panel.language:
            return _withheld()
        if ctx.panel.language not in ctx.node.languages:
            return RuleResult("not_applicable")
        wordings = _terms(ctx, keys, ctx.panel.language)
        if not wordings:
            return _withheld()
        found, line = find_printed(ctx.panel, wordings)
        return _passed(line) if found else failed
    # any_panel: printed on any panel of the artwork, each panel read in its own language.
    unknown = False
    for p in ctx.panels:
        wordings = _terms(ctx, keys, p.language)
        if not p.assessable or not wordings:
            unknown = True
            continue
        found, line = find_printed(p, wordings)
        if found:
            return _passed(line if p.id == ctx.panel.id else None)
    if unknown:
        return _withheld()
    return RuleResult("failed", message=f"{particular}: not found on any panel.")


@evaluator("prescribed_wording")
def prescribed_wording(ctx: RuleContext) -> RuleResult:
    params = ctx.rule.params
    term_key = params.get("term_key")
    if not isinstance(term_key, str) or not term_key:
        return _withheld()
    match = params.get("match", MATCHES[0])
    if match not in MATCHES:
        raise InvalidParams(f"{ctx.rule.rule_key}: unknown match")
    language = ctx.panel.language
    if language and ctx.node.languages and language not in ctx.node.languages:
        return RuleResult("not_applicable")          # a market's wording is judged on its own language panels
    prescribed = _terms(ctx, [term_key], language)
    if not prescribed:
        return _withheld()
    alternatives = params.get("alternatives") or []
    if isinstance(alternatives, dict):
        alternatives = alternatives.get(language) or []
    if not isinstance(alternatives, list) or not all(isinstance(a, str) for a in alternatives):
        raise InvalidParams(f"{ctx.rule.rule_key}: alternatives are not a list of wordings")
    found, line = find_printed(ctx.panel, prescribed + alternatives, fold=match == "case_folded")
    if found:
        return _passed(line)
    return RuleResult("failed", message=f"{ctx.rule.title}: the prescribed {language} wording is not printed.")


# ─── The fixtures runner (docs/05 §The runner) ─────────────────────────────────────────────────────────────────────
# A rule fixture's input: {"panel": {...}, "panels": [{...}] (optional, the whole artwork), "node": {"id",
# "languages", "region"}, "classification": {...}, "product": {"format"}}; a panel is {"index", "language", "status",
# "failure_code", "text_objects": [{"text"}]}. Params, applicability and terms come from the store, never the input.

def _panel(data: Any, index: int = 0) -> Panel:
    if not isinstance(data, dict):
        raise InvalidParams("a fixture panel is an object")
    lines = tuple(TextLine(str(t.get("text", "")), str(t["id"]) if t.get("id") else None, t.get("bbox_mm"))
                  for t in data.get("text_objects") or [] if isinstance(t, dict))
    language = data.get("language")
    status = data.get("status") or ("not_assessable" if data.get("failure_code") else "extracted")
    return Panel(int(data.get("index", index)), language if language and language != "und" else None, status,
                 data.get("failure_code"), lines, str(data.get("id", f"panel-{data.get('index', index)}")))


def evaluate_fixture(f: fr.RuleFixture) -> fr.Evaluation:
    data = f.input or {}
    panel = _panel(data.get("panel"))
    panels = tuple(_panel(p, i) for i, p in enumerate(data.get("panels") or [])) or (panel,)
    n = data.get("node") or {}
    node = Node(str(n.get("id", "")), tuple(n.get("languages") or ()), n.get("region"))
    base = {**{k: v for k, v in (data.get("classification") or {}).items()},
            "format": (data.get("product") or {}).get("format")}
    rule = Rule(f.rule_key, f.version, f.shape, "", node.id, f.name, f.params or {}, f.applicability or {"all": []},
                "")
    terms = {(k, lang): tuple(v) for (k, lang), v in (f.terms or {}).items()}
    ctx = RuleContext(rule, panel, panels, node, terms, facts_for(base, node, panel))
    r = evaluate_rule(ctx)
    if r.outcome == "not_applicable":
        return fr.Evaluation("withheld", reason=r.reason or "not_applicable")
    if r.outcome == "failed":
        return fr.Evaluation("failed", findings=[{"rule_key": f.rule_key, "state": "action",
                                                   "provenance": r.provenance}])
    return fr.Evaluation(r.outcome, reason=r.reason if r.outcome == "withheld" else None)


for _shape in ("mandatory_particular", "prescribed_wording"):
    fr.EVALUATORS[_shape] = evaluate_fixture

__all__ = ["Coverage", "evaluate_fixture", "mandatory_particular", "prescribed_wording"]
