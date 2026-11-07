"""T-503: the claim_judgement evaluator behind the claims harness threshold (docs/05, docs/07, D04).

A scripted fake model only: nothing here reaches the network or a real model. Rules, claims and criteria are
synthetic test data (TEST.T503.*), never regulatory content."""
import json
import re

import pytest
from fakes import FakeProvider, FakeStore

from nutrivo_worker.config import WORKER_ROOT, Settings
from nutrivo_worker.engine import core
from nutrivo_worker.engine.claims import CLAIM_NOT_EVALUATED, StaticThresholdRecords
from nutrivo_worker.engine.core import Coverage, Node, Panel, Rule, TextLine, evaluate_check
from nutrivo_worker.models import Models, Raw

SE = Node("EU-SE", ("sv",), "EU")
COMPLETE = [Coverage(d, "complete", None, None) for d in core.COVERAGE_DOMAINS]
FACTS = {"species": "cat", "life_stage": "adult", "product_class": "complete", "intended_use": None,
         "parnut_status": None, "format": "dry"}
PARAMS = {"question": "Does the printed text name a colour? (synthetic test rule)",
          "criteria": ["A synthetic test criterion: naming a colour is prohibited."],
          "examples": [{"text": "Blå testkula", "label": "prohibited", "lang": "sv"}],
          "min_confidence": 0.7}
KEY = "TEST.T503.CLAIM"
PASSED_SV = StaticThresholdRecords(frozenset({(KEY, 1, "sv")}))
_CLAIM = re.compile(r'<data name="claim_text">\n(.*?)\n</data>', re.DOTALL)
_LANG = re.compile(r'<data name="panel_language">\n(.*?)\n</data>', re.DOTALL)


def answer(judgement="permitted", confidence=0.9, abstain=False):
    return json.dumps({"abstain": abstain, "judgement": judgement, "confidence": confidence,
                       "reason": "Synthetic test answer."})


class ScriptedModel:
    """Answers by the printed claim text; anything unscripted is an abstention."""

    name = "bedrock"

    def __init__(self, script=None, fail=False):
        self.script, self.fail, self.calls = script or {}, fail, []

    def model_for(self, model_class):
        return {"judgement": "eu.judge"}.get(model_class)

    def complete(self, model_id, system, user, schema, max_tokens):
        claim, lang = _CLAIM.search(user).group(1), _LANG.search(user).group(1)
        self.calls.append({"claim": claim, "lang": lang})
        if self.fail:
            raise ConnectionError("provider down")
        return Raw(self.name, model_id, self.script.get(claim, answer(None, 0.0, abstain=True)), "end_turn", 90, 20)


def models_for(tmp_path, provider):
    return Models(Settings(models_mode="live", prompts_dir=WORKER_ROOT / "prompts",
                           cassette_dir=tmp_path / "cassettes"), [provider])


def rule(params=None, appl=None):
    return Rule(KEY, 1, "claim_judgement", "claims_wording", "EU", "Synthetic claim rule",
                PARAMS if params is None else params, appl or {"all": []}, "TEST Art. 3")


def panel(lang, *texts, status="extracted", failure=None):
    return Panel(0, lang, status, failure, tuple(TextLine(t, f"t{i}", [0, 0, 1, 1]) for i, t in enumerate(texts)),
                 f"p-{lang}")


def check(tmp_path, p, model, *, thresholds=PASSED_SV, rules=None, node=SE, store=None):
    store = store if store is not None else FakeStore()
    res = evaluate_check(node, p, (p,), rules or [rule()], COMPLETE, {}, FACTS,
                         models=models_for(tmp_path, model), workspace_id="ws", model_store=store,
                         claim_thresholds=thresholds)
    return res, store


# ─── The harness threshold gate ───────────────────────────────────────────────────────────────────────────────────

def test_without_a_harness_threshold_record_the_rule_is_withheld_and_no_model_is_called(tmp_path):
    model = ScriptedModel({"Grön testkula": answer("prohibited")})
    for thresholds in (None, StaticThresholdRecords(frozenset({(KEY, 1, "da"), (KEY, 2, "sv")}))):
        res, store = check(tmp_path, panel("sv", "Grön testkula"), model, thresholds=thresholds)
        assert res.withheld == [KEY] and res.label_state == "not_assessed"
        assert res.findings[0]["reason_code"] == CLAIM_NOT_EVALUATED
        assert res.findings[0]["provenance"] == "not_assessed"
    assert model.calls == [] and store.model_calls == []


def test_the_threshold_is_per_rule_version_and_language(tmp_path):
    model = ScriptedModel({"Grön testkula": answer("prohibited")})
    res, _ = check(tmp_path, panel("sv", "Grön testkula"), model,
                   thresholds=StaticThresholdRecords(frozenset({(KEY, 1, "sv")})))
    assert res.label_state == "action"


# ─── Judgements ───────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_prohibited_judgement_at_min_confidence_fails_with_model_provenance_pinned_and_recorded(tmp_path):
    model = ScriptedModel({"Testkula": answer("permitted"), "Grön testkula": answer("prohibited", 0.7)})
    res, store = check(tmp_path, panel("sv", "Testkula", "Grön testkula"), model)
    assert res.label_state == "action" and res.applied == [KEY] and res.passed == []
    [f] = res.findings
    assert (f["rule_key"], f["state"], f["provenance"], f["text_object_id"]) == (KEY, "action", "model_judgement",
                                                                                "t1")
    assert f["confidence"] == 0.7 and f["model_call_id"] and f["citation"] == "TEST Art. 3"
    assert [c["prompt_version"] for c in store.model_calls] == ["claim_judgement.v1"] * 2
    assert all(c["workspace_id"] == "ws" for c in store.model_calls)


def test_needs_evidence_fails_the_rule(tmp_path):
    res, _ = check(tmp_path, panel("sv", "Testkula som lyser"), ScriptedModel({"Testkula som lyser":
                                                                              answer("needs_evidence", 0.95)}))
    assert res.label_state == "action" and res.findings[0]["provenance"] == "model_judgement"


def test_every_text_object_permitted_passes_the_rule(tmp_path):
    model = ScriptedModel({"Testkula": answer("permitted"), "Rund testkula": answer("permitted", 0.8)})
    res, _ = check(tmp_path, panel("sv", "Testkula", "Rund testkula", "Testkula"), model)
    assert res.passed == [KEY] and res.findings == [] and res.label_state == "clear"
    assert [c["claim"] for c in model.calls] == ["Testkula", "Rund testkula"]    # the same string judged once


@pytest.mark.parametrize("raw", [answer(None, 0.0, abstain=True), answer("permitted", 0.69),
                                 answer("prohibited", 0.5)])
def test_abstention_or_low_confidence_is_withheld_model_abstained_never_passed(tmp_path, raw):
    res, _ = check(tmp_path, panel("sv", "Testkula"), ScriptedModel({"Testkula": raw}))
    assert res.withheld == [KEY] and res.passed == [] and res.label_state == "not_assessed"
    assert res.findings[0]["reason_code"] == "model_abstained"


def test_an_abstention_keeps_its_confidence_and_model_call_for_tracing(tmp_path):
    res, store = check(tmp_path, panel("sv", "Testkula"), ScriptedModel({"Testkula": answer("permitted", 0.4)}))
    [f] = res.findings
    assert (f["reason_code"], f["provenance"], f["confidence"]) == ("model_abstained", "not_assessed", 0.4)
    assert f["model_call_id"] and len(store.model_calls) == 1


def test_one_judgement_per_string_per_job_across_markets_and_panels(tmp_path):
    """The same printed string in two markets of the same language is one model call, not one per market."""
    model = ScriptedModel({"Testkula": answer("permitted"), "Grön testkula": answer("prohibited")})
    models, store, cache = models_for(tmp_path, model), FakeStore(), {}
    fi = Node("EU-FI", ("fi", "sv"), "EU")
    p1, p2 = panel("sv", "Testkula", "Grön testkula"), panel("sv", "Grön testkula")
    results = [evaluate_check(node, p, (p1, p2), [rule()], COMPLETE, {}, FACTS, models=models, workspace_id="ws",
                              model_store=store, claim_thresholds=PASSED_SV, judgement_cache=cache)
               for node in (SE, fi) for p in (p1, p2)]
    assert [r.label_state for r in results] == ["action"] * 4
    assert all(r.findings[0]["model_call_id"] for r in results)
    assert sorted(c["claim"] for c in model.calls) == ["Grön testkula", "Testkula"]


def test_a_failure_elsewhere_on_the_panel_still_fails_after_an_abstention(tmp_path):
    model = ScriptedModel({"Grön testkula": answer("prohibited")})       # "Oklar" is unscripted: an abstention
    res, _ = check(tmp_path, panel("sv", "Oklar", "Grön testkula"), model)
    assert res.label_state == "action" and res.findings[0]["text_object_id"] == "t1"


def test_invalid_params_are_an_evaluator_error_and_no_model_is_called(tmp_path):
    model = ScriptedModel({"Testkula": answer("permitted")})
    res, _ = check(tmp_path, panel("sv", "Testkula"), model, rules=[rule({**PARAMS, "min_confidence": 0})])
    assert res.withheld == [KEY] and res.findings[0]["reason_code"] == "evaluator_error" and model.calls == []


def test_a_panel_with_no_printed_text_or_unknown_language_is_withheld_data_missing(tmp_path):
    model = ScriptedModel()
    assert check(tmp_path, panel("sv"), model)[0].findings[0]["reason_code"] == "data_missing"
    assert check(tmp_path, panel(None, "Testkula"), model)[0].findings[0]["reason_code"] == "data_missing"
    assert model.calls == []


def test_a_not_assessable_panel_withholds_with_its_failure_code(tmp_path):
    model = ScriptedModel()
    res, _ = check(tmp_path, panel("sv", "Testkula", status="not_assessable", failure="rasterised"), model)
    assert res.findings[0]["reason_code"] == "rasterised" and model.calls == []


def test_a_failure_without_a_model_call_id_is_never_written_as_a_model_finding(tmp_path):
    class NoIdStore(FakeStore):
        def insert_model_call(self, row):
            self.model_calls.append(row)

    res, _ = check(tmp_path, panel("sv", "Grön testkula"), ScriptedModel({"Grön testkula": answer("prohibited")}),
                   store=NoIdStore())
    assert res.withheld == [KEY] and res.findings[0]["reason_code"] == "evaluator_error"


# ─── D04 acceptance, for claim_judgement ──────────────────────────────────────────────────────────────────────────

def test_D04_must_2_claim_judgement_sends_the_printed_target_language_string_untranslated(tmp_path):
    """[D04.must.2] The model gets the Swedish panel's printed string and its language, never a translation; an
    English panel is not judged by the Swedish market's claim rule, and an English pass record never covers sv."""
    model = ScriptedModel({"Grön testkula": answer("prohibited")})
    res, _ = check(tmp_path, panel("sv", "Grön testkula"), model)
    assert res.label_state == "action" and model.calls == [{"claim": "Grön testkula", "lang": "sv"}]
    en, _ = check(tmp_path, panel("en", "Green test ball"), model)
    assert en.applied == [] and en.withheld == [] and len(model.calls) == 1
    only_en = StaticThresholdRecords(frozenset({(KEY, 1, "en")}))
    sv, _ = check(tmp_path, panel("sv", "Grön testkula"), model, thresholds=only_en)
    assert sv.findings[0]["reason_code"] == CLAIM_NOT_EVALUATED and len(model.calls) == 1


def test_D04_fail_2_claim_judgement_with_no_provider_is_withheld_model_unavailable(tmp_path):
    """[D04.fail.2] Every provider failing withholds the claim rule 'model_unavailable', never passes it."""
    res, store = check(tmp_path, panel("sv", "Testkula"), FakeProvider(fail=99))
    assert res.withheld == [KEY] and res.passed == [] and res.label_state == "not_assessed"
    assert res.findings[0]["reason_code"] == "model_unavailable" and store.model_calls == []
