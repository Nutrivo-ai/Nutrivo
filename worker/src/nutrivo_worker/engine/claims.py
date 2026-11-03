"""The claim_judgement evaluator (T-503, docs/05 §Shapes, BE-22), behind the claims harness threshold (T-501).

A claim rule is judged by the model only for a (rule version, panel language) whose evaluation set met the harness
threshold (docs/07 "Evaluation before use": at least 50 human-labelled cases, kappa >= 0.8, nothing prohibited judged
permitted). Without such a record the rule is withheld `claim_not_evaluated` and no model is called. Where the
record lives is open on #53 (Q1): `ThresholdRecords` is injected, and the default holds none, so in a real check every
claim rule is withheld until a person-accepted record source is decided.

Behind the threshold, each text object of the panel is judged as printed, in the panel's own language, through
`nutrivo_worker.models` with the prompt the harness measured (`claim_judgement.v1`) and the rule version's own
question, criteria, examples and min_confidence (never this module's):
- `prohibited` or `needs_evidence` at confidence >= min_confidence fails the rule (provenance model_judgement, with
  the confidence and the app.model_calls id), pinned to that text object;
- an abstention or a confidence below min_confidence is withheld `model_abstained`, and a model error keeps its own
  reason; withheld is never passed, but a failure elsewhere on the panel still fails the rule;
- the rule passes only when every text object was judged `permitted` at >= min_confidence.
The model never decides whether the rule applies (applicability did), never names a rule, and its finding is always
under this rule's rule_key (CLAUDE.md 6)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import sentry_sdk

from ..errors import ModelError
from ..evals.claims import PROMPT_VERSION, PURPOSE, ClaimJudgement, RuleSpec
from ..logs import get_logger, kv
from .core import DATA_MISSING, EVALUATOR_ERROR, RuleContext, RuleResult, TextLine, evaluator, normalise

log = get_logger(__name__)

CLAIM_NOT_EVALUATED = "claim_not_evaluated"   # no harness threshold record for the rule version and language
MODEL_ABSTAINED = "model_abstained"
FAILING = frozenset({"prohibited", "needs_evidence"})


class ThresholdRecords(Protocol):
    """Whether the harness threshold was met for this rule version in this language, as accepted by a person."""

    def passed(self, rule_key: str, version: int, lang: str) -> bool: ...


class NoThresholdRecords:
    """The default until #53 Q1 is decided: nothing is recorded, so nothing is judged."""

    def passed(self, rule_key: str, version: int, lang: str) -> bool:
        return False


@dataclass(frozen=True)
class StaticThresholdRecords:
    """A fixed set of (rule_key, version, lang) passes, for tests and for a future reviewed source."""

    passes: frozenset[tuple[str, int, str]]

    def passed(self, rule_key: str, version: int, lang: str) -> bool:
        return (rule_key, version, lang) in self.passes


class _CaptureCallId:
    """Passes each app.model_calls row to the job's store and keeps the id it returns, for
    check_findings.model_call_id (required on every model_judgement finding)."""

    def __init__(self, inner: Any):
        self.inner: Any = inner
        self.id: str | None = None

    def insert_model_call(self, row: dict[str, Any]) -> None:
        self.id = None
        if self.inner is not None:
            got = self.inner.insert_model_call(row)
            self.id = str(got) if got else None


@dataclass
class _Judged:
    line: TextLine
    outcome: str            # "permitted", "failed" or "withheld"
    reason: str | None = None
    judgement: str | None = None
    confidence: float | None = None
    model_call_id: str | None = None


def _judge(ctx: RuleContext, spec: RuleSpec, line: TextLine, lang: str) -> _Judged:
    inputs = {"claim_text": line.text, "panel_language": lang, "question": spec.question,
              "criteria": spec.criteria, "examples": spec.examples_for(lang)}
    capture = _CaptureCallId(ctx.model_store)
    try:
        out: ClaimJudgement = ctx.models.call(PURPOSE, PROMPT_VERSION, inputs, ClaimJudgement,
                                              workspace_id=ctx.workspace_id, store=capture)
    except ModelError as exc:
        return _Judged(line, "withheld", exc.reason)
    if out.abstain or out.judgement is None or out.confidence < spec.min_confidence:
        return _Judged(line, "withheld", MODEL_ABSTAINED, out.judgement, out.confidence, capture.id)
    if out.judgement in FAILING:
        return _Judged(line, "failed", None, out.judgement, out.confidence, capture.id)
    return _Judged(line, "permitted", None, out.judgement, out.confidence, capture.id)


@evaluator("claim_judgement")
def claim_judgement(ctx: RuleContext) -> RuleResult:
    rule, lang = ctx.rule, ctx.panel.language
    # RuleSpecInvalid propagates: the engine withholds it as evaluator_error and reports it, never passes it.
    spec = RuleSpec.from_params(rule.rule_key, rule.version, "member", rule.params)
    if not lang:
        return RuleResult("withheld", DATA_MISSING)
    if ctx.node.languages and lang not in ctx.node.languages:
        return RuleResult("not_applicable")          # a market's claims are judged on its own language panels
    thresholds = ctx.claim_thresholds or NoThresholdRecords()
    if not thresholds.passed(rule.rule_key, rule.version, lang):
        return RuleResult("withheld", CLAIM_NOT_EVALUATED)
    if ctx.models is None:
        return RuleResult("withheld", "model_unavailable")
    lines = [ln for ln in ctx.panel.lines if ln.text and ln.text.strip()]
    if not lines:
        return RuleResult("withheld", DATA_MISSING)
    seen: dict[str, _Judged] = {}
    withheld: str | None = None
    for line in lines:
        key = normalise(line.text, fold=False)
        j = seen.get(key)
        if j is None:
            j = seen[key] = _judge(ctx, spec, line, lang)
            log.info("claim judged", extra=kv(rule_key=rule.rule_key, lang=lang, text_object_id=line.id,
                                              outcome=j.outcome, reason=j.reason))
        if j.outcome == "failed":
            if not j.model_call_id:
                # A model finding needs its app.model_calls row (check_findings constraint): never written without.
                sentry_sdk.capture_message("claim_judgement failure without a model_call id", level="error")
                return RuleResult("withheld", EVALUATOR_ERROR)
            return RuleResult("failed", provenance="model_judgement", confidence=j.confidence,
                              model_call_id=j.model_call_id, text_object_id=line.id, bbox_mm=line.bbox_mm,
                              message=f"{rule.title}: a claim on the {lang} panel is judged {j.judgement} "
                                      f"(confidence {j.confidence:.2f}).")
        if j.outcome == "withheld":
            withheld = withheld or j.reason
    if withheld:
        return RuleResult("withheld", withheld)
    return RuleResult("passed")


__all__ = ["CLAIM_NOT_EVALUATED", "NoThresholdRecords", "StaticThresholdRecords", "ThresholdRecords",
           "claim_judgement"]
