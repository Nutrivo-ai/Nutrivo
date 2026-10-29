"""T-403: the rules engine core and the mandatory_particular and prescribed_wording evaluators (docs/05, D04).

Rules, terms and wording here are synthetic test data (TEST.T403.*), never regulatory content."""
import pytest
from fakes import FakeProvider, FakeStore
from pydantic import BaseModel

from nutrivo_worker import fixtures_runner as fr
from nutrivo_worker.config import Settings
from nutrivo_worker.engine import applicability, core
from nutrivo_worker.engine.core import Coverage, Node, Panel, Rule, TextLine, evaluate_check
from nutrivo_worker.models import Models

SE = Node("EU-SE", ("sv",), "EU")
COMPLETE = [Coverage(d, "complete", None, None) for d in ("mandatory_particulars", "claims_wording")]
TERMS = {("test_batch", "sv"): ("Testparti",), ("test_batch", "en"): ("Test lot",),
         ("test_designation", "sv"): ("Testfoder för katter",), ("test_designation", "en"): ("Test food for cats",)}
FACTS = {"species": "cat", "life_stage": "adult", "product_class": "complete", "intended_use": None,
         "parnut_status": None, "format": "dry"}


def rule(key="TEST.T403.BATCH", shape="mandatory_particular", params=None, appl=None, domain="mandatory_particulars"):
    if params is None:
        params = {"particular": "Test batch", "detect": {"term_keys": ["test_batch"]}}
    return Rule(key, 1, shape, domain, "EU", "Synthetic test rule", params, appl or {"all": []}, "TEST Art. 1")


def panel(lang="sv", *texts, status="extracted", failure=None, pid=None):
    return Panel(0, lang, status, failure, tuple(TextLine(t, f"t{i}", [0, 0, 1, 1]) for i, t in enumerate(texts)),
                 pid or f"p-{lang}")


def check(p, rules, coverage=COMPLETE, panels=None, node=SE, facts=FACTS, **kw):
    return evaluate_check(node, p, panels or (p,), rules, coverage, TERMS, facts, **kw)


# ─── Applicability ────────────────────────────────────────────────────────────────────────────────────────────────

def test_applicability_is_three_valued_and_a_missing_field_is_never_true_or_false():
    facts = {"species": "cat", "life_stage": None}
    assert applicability.evaluate({"eq": ["species", "cat"]}, facts) is True
    assert applicability.evaluate({"eq": ["life_stage", "adult"]}, facts) == applicability.UNKNOWN
    assert applicability.evaluate({"not": {"eq": ["life_stage", "adult"]}}, facts) == applicability.UNKNOWN
    assert applicability.evaluate({"all": [{"eq": ["species", "dog"]}, {"eq": ["life_stage", "x"]}]}, facts) is False
    assert applicability.evaluate({"any": [{"eq": ["species", "cat"]}, {"has": "life_stage"}]}, facts) is True
    assert applicability.evaluate({"in": ["species", ["dog", "cat"]]}, facts) is True
    assert applicability.evaluate({"has": "life_stage"}, facts) is False
    assert applicability.evaluate({"all": []}, facts) is True
    with pytest.raises(applicability.InvalidPredicate):
        applicability.evaluate({"eq": ["colour", "red"]}, facts)
    with pytest.raises(applicability.InvalidPredicate):
        applicability.evaluate({"xor": []}, facts)


def test_unknown_applicability_is_withheld_data_missing_and_false_is_not_applied():
    r1 = rule("TEST.T403.A", appl={"eq": ["intended_use", "x"]})
    r2 = rule("TEST.T403.B", appl={"eq": ["species", "dog"]})
    res = check(panel("sv", "Testparti 123"), [r1, r2])
    assert res.withheld == ["TEST.T403.A"] and res.applied == []
    assert [f["reason_code"] for f in res.findings] == ["data_missing"]
    assert res.label_state == "not_assessed"


# ─── The two evaluators ───────────────────────────────────────────────────────────────────────────────────────────

def test_mandatory_particular_passes_when_printed_and_fails_when_absent():
    ok = check(panel("sv", "Sammansättning", "testparti: L123"), [rule()])
    assert (ok.applied, ok.passed, ok.findings, ok.label_state) == (["TEST.T403.BATCH"], ["TEST.T403.BATCH"], [],
                                                                   "clear")
    bad = check(panel("sv", "Sammansättning"), [rule()])
    assert bad.label_state == "action" and bad.passed == []
    [f] = bad.findings
    assert (f["state"], f["provenance"], f["rule_key"], f["citation"]) == ("action", "deterministic_rule",
                                                                          "TEST.T403.BATCH", "TEST Art. 1")


def test_mandatory_particular_without_term_keys_is_withheld_never_guessed():
    r = rule(params={"particular": "Test batch", "conditions": []})       # the K02 extraction's params alone
    res = check(panel("sv", "Testparti"), [r])
    assert res.withheld == ["TEST.T403.BATCH"] and res.findings[0]["reason_code"] == "data_missing"


def test_mandatory_particular_scope_any_panel_reads_each_panel_in_its_own_language():
    r = rule(params={"detect": {"term_keys": ["test_batch"]}, "scope": "any_panel"})
    sv, en = panel("sv", "Sammansättning"), panel("en", "Test lot: 42", pid="p-en")
    res = check(sv, [r], panels=(sv, en))
    assert res.passed == ["TEST.T403.BATCH"]
    hidden = panel("fi", "", status="not_assessable", failure="outlined_text", pid="p-fi")
    res = check(sv, [r], panels=(sv, hidden))
    assert res.withheld == ["TEST.T403.BATCH"]          # it may be printed where nothing can be read


def test_prescribed_wording_case_folded_exact_and_alternatives():
    r = rule("TEST.T403.DESIG", "prescribed_wording", {"term_key": "test_designation"})
    assert check(panel("sv", "TESTFODER  FÖR  katter"), [r]).label_state == "clear"
    exact = rule("TEST.T403.DESIG", "prescribed_wording", {"term_key": "test_designation", "match": "exact"})
    assert check(panel("sv", "TESTFODER FÖR KATTER"), [exact]).label_state == "action"
    alt = rule("TEST.T403.DESIG", "prescribed_wording",
               {"term_key": "test_designation", "alternatives": {"sv": ["Testkost för katter"]}})
    assert check(panel("sv", "Testkost för katter"), [alt]).label_state == "clear"
    assert check(panel("sv", "Testkost för hundar"), [alt]).label_state == "action"


def test_prescribed_wording_with_no_register_entry_for_the_language_is_withheld():
    r = rule("TEST.T403.DESIG", "prescribed_wording", {"term_key": "test_designation"})
    res = check(panel("da", "Testfoder til katte"), [r], node=Node("EU-DK", ("da",), "EU"))
    assert res.withheld == ["TEST.T403.DESIG"] and res.findings[0]["reason_code"] == "data_missing"


def test_invalid_params_are_an_evaluator_error_withheld_never_passed():
    r = rule("TEST.T403.DESIG", "prescribed_wording", {"term_key": "test_designation", "match": "fuzzy"})
    res = check(panel("sv", "Testfoder för katter"), [r])
    assert res.withheld == ["TEST.T403.DESIG"] and res.findings[0]["reason_code"] == "evaluator_error"


def test_a_shape_without_an_evaluator_is_withheld_evaluator_missing():
    r = rule("TEST.T403.H", "character_height", {}, domain="type_geometry")
    res = check(panel("sv", "x"), [r])
    assert res.withheld == ["TEST.T403.H"] and res.findings[0]["reason_code"] == "evaluator_missing"


def test_a_panel_that_is_not_assessable_withholds_every_rule_with_its_failure_code():
    p = panel("sv", status="not_assessable", failure="rasterised")
    res = check(p, [rule(), rule("TEST.T403.DESIG", "prescribed_wording", {"term_key": "test_designation"})])
    assert res.withheld == ["TEST.T403.BATCH", "TEST.T403.DESIG"] and res.applied == []
    assert {(f["reason_code"], f["panel_id"]) for f in res.findings} == {("rasterised", p.id)}


# ─── D04 acceptance (engine level; the database path is in test_check_pg.py) ──────────────────────────────────────

def test_D04_must_1_incomplete_coverage_never_returns_clear_and_resolves_to_its_gap():
    """[D04.must.1] No rule, no verdict: a passing rule does not make an incompletely encoded market clear."""
    cov = [Coverage("mandatory_particulars", "complete", None, None),
           Coverage("claims_wording", "partial", "GAP-TEST-CLAIMS", "partially_encoded")]
    res = check(panel("sv", "Testparti"), [rule()], coverage=cov)
    assert res.passed == ["TEST.T403.BATCH"] and res.label_state == "not_assessed"
    [gap] = res.findings
    assert (gap["gap_id"], gap["reason_code"], gap["state"], gap["rule_key"]) == (
        "GAP-TEST-CLAIMS", "partially_encoded", "not_assessed", None)
    assert check(panel("sv", "Testparti"), [rule()], coverage=[]).label_state == "not_assessed"
    assert check(panel("sv", "Testparti"), [], coverage=COMPLETE).label_state == "not_assessed"  # nothing applied


def test_D04_must_2_claims_are_judged_on_the_printed_target_language_string():
    """[D04.must.2] The Swedish panel needs the Swedish term: English wording printed there never satisfies it, and
    an English panel is not judged by a Swedish market's rules."""
    r = rule("TEST.T403.DESIG", "prescribed_wording", {"term_key": "test_designation"}, domain="claims_wording")
    assert check(panel("sv", "Test food for cats"), [r]).label_state == "action"
    assert check(panel("sv", "Testfoder för katter"), [r]).label_state == "clear"
    en = check(panel("en", "Test food for cats", pid="p-en"), [rule()])
    assert en.applied == [] and en.withheld == [] and en.label_state == "not_assessed"
    assert check(panel("sv", "Test lot 42"), [rule()]).label_state == "action"


def test_D04_must_3_applied_passed_and_withheld_are_recorded_apart():
    """[D04.must.3] BE-23: three first-class lists, passed within applied, withheld disjoint from applied."""
    rules = [rule("TEST.T403.A"), rule("TEST.T403.B", params={"detect": {"term_keys": ["test_designation"]}}),
             rule("TEST.T403.C", appl={"eq": ["intended_use", "x"]})]
    res = check(panel("sv", "Testparti"), rules)
    assert res.applied == ["TEST.T403.A", "TEST.T403.B"]
    assert res.passed == ["TEST.T403.A"]
    assert res.withheld == ["TEST.T403.C"]


def test_D04_must_4_every_finding_carries_provenance_and_a_rule_key_or_gap_id():
    """[D04.must.4] Provenance on every finding, and every not_assessed one has a reason code."""
    cov = [Coverage("type_geometry", "not_encoded", "GAP-TEST-GEOM", "not_encoded")]
    rules = [rule("TEST.T403.A"), rule("TEST.T403.C", appl={"eq": ["intended_use", "x"]}),
             rule("TEST.T403.H", "character_height", {}, domain="type_geometry")]
    res = check(panel("sv", "nothing relevant"), rules, coverage=cov)
    assert len(res.findings) == 4
    for f in res.findings:
        assert f["provenance"] in ("deterministic_rule", "model_judgement", "authored_definition", "not_assessed")
        assert f["rule_key"] or f["gap_id"]
        assert (f["state"] == "not_assessed") == (f["provenance"] == "not_assessed")
        assert f["state"] != "not_assessed" or f["reason_code"]


class Judgement(BaseModel):
    permitted: bool
    confidence: float


def test_D04_fail_2_model_unavailable_withholds_claim_rules_as_model_unavailable(tmp_path, monkeypatch):
    """[D04.fail.2] A model-backed claim rule whose providers all fail is withheld 'model_unavailable', never
    passed; the deterministic rules beside it still run."""
    settings = Settings(models_mode="live", cassette_dir=tmp_path / "cassettes")
    down = Models(settings, [FakeProvider(fail=99), FakeProvider("anthropic", fail=99)])
    store = FakeStore()

    def claim(ctx):            # the shape of a model-backed evaluator: it calls nutrivo_worker.models only
        out = ctx.models.call("claim_judgement", "v1", {"text": ctx.panel.lines[0].text,
                                                        "panel_language": ctx.panel.language},
                              Judgement, workspace_id=ctx.workspace_id, store=ctx.model_store)
        return core.RuleResult("passed" if out.permitted else "failed", provenance="model_judgement")

    monkeypatch.setitem(core.EVALUATORS, "claim_judgement", claim)
    rules = [rule(), rule("TEST.T403.CLAIM", "claim_judgement", {}, domain="claims_wording")]
    res = check(panel("sv", "Testparti"), rules, models=down, workspace_id="ws", model_store=store)
    assert res.withheld == ["TEST.T403.CLAIM"] and res.passed == ["TEST.T403.BATCH"]
    [f] = res.findings
    assert (f["reason_code"], f["state"], f["provenance"]) == ("model_unavailable", "not_assessed", "not_assessed")
    assert res.label_state == "not_assessed" and store.model_calls == []


def test_label_state_over_panels_is_the_worst():
    assert core.worst(["clear", "action", "not_assessed"]) == "action"
    assert core.worst(["clear", "not_assessed"]) == "not_assessed"
    assert core.worst(["clear"]) == "clear" and core.worst([]) == "not_assessed"


# ─── The fixtures runner ──────────────────────────────────────────────────────────────────────────────────────────

def fixture(name, outcome, panel_data, params=None, expected=None):
    return fr.RuleFixture(name, "TEST.T403.BATCH", 1, "mandatory_particular", name,
                          {"panel": panel_data, "node": {"id": "EU-SE", "languages": ["sv"], "region": "EU"}},
                          outcome, expected, params or {"detect": {"term_keys": ["test_batch"]}}, {"all": []},
                          {("test_batch", "sv"): ["Testparti"]})


def test_the_runner_judges_fixtures_with_the_registered_evaluators():
    import nutrivo_worker.engine  # noqa: F401  registers
    assert {"mandatory_particular", "prescribed_wording"} <= set(fr.EVALUATORS)
    fixtures = [
        fixture("present", "passed", {"language": "sv", "text_objects": [{"text": "Testparti 1"}]}),
        fixture("absent", "failed", {"language": "sv", "text_objects": [{"text": "x"}]},
                expected={"findings": [{"rule_key": "TEST.T403.BATCH"}]}),
        fixture("outlined", "withheld", {"language": "sv", "status": "not_assessable",
                                         "failure_code": "outlined_text"}, expected={"reason": "outlined_text"}),
    ]

    class Store:
        def members(self, rv):
            return [fr.Member("TEST.T403.BATCH", 1, "mandatory_particular")]

        def fixtures(self, rv):
            return fixtures

    results = fr.run_rule_fixtures(Store(), "t403")
    assert [(r.item, r.result) for r in results] == [("present", "matched"), ("absent", "matched"),
                                                     ("outlined", "matched")]
