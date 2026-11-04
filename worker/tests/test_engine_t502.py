"""T-502: the character_height, threshold and additive_condition evaluators (docs/05, D05).

Rules, terms, bands, quantities and register rows here are synthetic test data (TEST.T502.*), never regulatory
content. The database path is in test_check_height_pg.py."""
import datetime as dt

import nutrivo_worker.engine  # noqa: F401  registers the evaluators
from nutrivo_worker import fixtures_runner as fr
from nutrivo_worker.engine.core import COVERAGE_DOMAINS, Coverage, Node, Panel, Rule, TextLine, evaluate_check

SE = Node("EU-SE", ("sv",), "EU")
COMPLETE = [Coverage(d, "complete", None, None) for d in COVERAGE_DOMAINS]  # #179 DB-1: all six
TERMS = {("test_weight", "sv"): ("Testvikt",), ("test_weight", "en"): ("Test weight",),
         ("test_moisture", "sv"): ("Testfukt",)}
FACTS = {"species": "cat", "life_stage": "adult", "product_class": "complete", "intended_use": None,
         "parnut_status": None, "format": "dry", "quantity": None, "quantities": {}, "additives": []}
BAND = [{"quantity_from": None, "quantity_to": None, "quantity_unit": "g", "min_height_mm": 2.0}]


def height_rule(key="TEST.T502.HEIGHT", **params):
    p = {"target": "Test weight", "height_definition": "x_height", "bands": BAND,
         "detect": {"term_keys": ["test_weight"]}, **params}
    return Rule(key, 1, "character_height", "type_geometry", "EU-SE", "Synthetic height rule", p, {"all": []},
                "TEST Art. 9")


def line(text, x=None, cap=None, *, ocr=False, i=0):
    return TextLine(text, f"t{i}", [1.0, 2.0, 30.0, 6.0], x, cap, ocr)


def panel(lang="sv", *lines, status="extracted", failure=None, pid=None):
    return Panel(0, lang, status, failure, tuple(lines), pid or f"p-{lang}")


def check(p, rules, *, facts=FACTS, node=SE, panels=None):
    return evaluate_check(node, p, panels or (p,), rules, COMPLETE, TERMS, facts)


# ─── D05 acceptance ───────────────────────────────────────────────────────────────────────────────────────────────

def test_D05_main_character_height_compares_the_named_height_with_the_band_minimum():
    """[D05.main] The measured height named by the rule is compared with the band minimum; a failure carries bbox,
    measured_mm, required_mm and height_definition, and a pass is clear."""
    low = check(panel("sv", line("Sammansättning", 1.0, 1.4), line("Testvikt 400 g", 1.62, 2.3, i=1)), [height_rule()])
    assert low.label_state == "action" and low.applied == ["TEST.T502.HEIGHT"] and low.passed == []
    [f] = low.findings
    assert (f["state"], f["provenance"], f["rule_key"], f["citation"]) == ("action", "deterministic_rule",
                                                                          "TEST.T502.HEIGHT", "TEST Art. 9")
    assert (f["measured_mm"], f["required_mm"], f["height_definition"]) == (1.62, 2.0, "x_height")
    assert (f["text_object_id"], f["bbox_mm"]) == ("t1", [1.0, 2.0, 30.0, 6.0])

    ok = check(panel("sv", line("Testvikt 400 g", 2.1, 2.9)), [height_rule()])
    assert (ok.label_state, ok.passed, ok.findings) == ("clear", ["TEST.T502.HEIGHT"], [])
    # The definition decides which measurement is read: the cap height here clears 2 mm, the x-height would not.
    cap = check(panel("sv", line("Testvikt 400 g", 1.5, 2.2)), [height_rule(height_definition="cap_height")])
    assert cap.label_state == "clear"


def test_D05_main_the_band_is_chosen_by_the_products_quantity_never_guessed():
    """[D05.main] Bands by quantity: the product's quantity selects one; without it, the rule is withheld."""
    bands = [{"quantity_from": None, "quantity_to": 100, "quantity_unit": "g", "min_height_mm": 2.0},
             {"quantity_from": 100, "quantity_to": None, "quantity_unit": "g", "min_height_mm": 3.0}]
    p = panel("sv", line("Testvikt 400 g", 2.5, 3.2))
    assert check(p, [height_rule(bands=bands)], facts={**FACTS, "quantity": {"value": 50, "unit": "g"}}
                 ).label_state == "clear"
    big = check(p, [height_rule(bands=bands)], facts={**FACTS, "quantity": {"value": 400, "unit": "g"}})
    assert big.label_state == "action" and big.findings[0]["required_mm"] == 3.0
    for facts in (FACTS, {**FACTS, "quantity": {"value": 0.4, "unit": "kg"}}):     # missing, or a unit not converted
        res = check(p, [height_rule(bands=bands)], facts=facts)
        assert res.withheld == ["TEST.T502.HEIGHT"] and res.findings[0]["reason_code"] == "data_missing"


def test_D05_must_1_no_true_scale_is_withheld_no_true_scale_never_estimated():
    """[D05.must.1] No true scale: withheld 'no_true_scale', never estimated: a no_true_scale panel, and a target
    read by OCR (no physical scale), even where a height value is present."""
    res = check(panel("sv", status="not_assessable", failure="no_true_scale"), [height_rule()])
    assert res.withheld == ["TEST.T502.HEIGHT"] and res.applied == []
    [f] = res.findings
    assert (f["reason_code"], f["state"], f["provenance"]) == ("no_true_scale", "not_assessed", "not_assessed")
    assert f.get("measured_mm") is None and res.label_state == "not_assessed"
    ocr = check(panel("sv", line("Testvikt 400 g", 0.9, 1.3, ocr=True)), [height_rule()])
    assert ocr.withheld == ["TEST.T502.HEIGHT"] and ocr.findings[0]["reason_code"] == "no_true_scale"


def test_D05_fail_1_outlined_figures_are_withheld_outlined_text():
    """[D05.fail.1] Outlined figures: withheld 'outlined_text', never passed or failed."""
    res = check(panel("sv", status="not_assessable", failure="outlined_text"), [height_rule()])
    assert res.withheld == ["TEST.T502.HEIGHT"] and res.applied == [] and res.label_state == "not_assessed"
    assert [(f["reason_code"], f["panel_id"]) for f in res.findings] == [("outlined_text", "p-sv")]


# ─── character_height: what is never estimated ────────────────────────────────────────────────────────────────────

def test_character_height_without_a_measurement_or_definition_is_withheld_data_missing():
    cases = [
        (height_rule(), panel("sv", line("Testvikt 400 g", None, 2.3))),                 # x-height not measured
        (height_rule(height_definition="figure_height"), panel("sv", line("Testvikt 400 g", 2.0, 3.0))),
        (Rule("TEST.T502.K02", 1, "character_height", "type_geometry", "EU-SE", "K02 params only",
              {"target": "Test weight", "bands": BAND}, {"all": []}, "TEST"), panel("sv", line("Testvikt", 3, 4))),
        (height_rule(), panel("sv", line("Sammansättning", 3.0, 4.0))),                  # target not found
        (height_rule(), panel(None, line("Testvikt 400 g", 3.0, 4.0))),                 # language unknown
    ]
    for r, p in cases:
        res = check(p, [r])
        assert res.withheld == [r.rule_key] and res.findings[0]["reason_code"] == "data_missing", r.params


def test_character_height_is_judged_only_on_the_markets_language_panels_and_rejects_bad_params():
    en = check(panel("en", line("Test weight 400 g", 0.5, 0.7)), [height_rule()])
    assert en.applied == [] and en.withheld == [] and en.findings == []
    bad = check(panel("sv", line("Testvikt", 3, 4)), [height_rule(height_definition="ascender")])
    assert bad.withheld == ["TEST.T502.HEIGHT"] and bad.findings[0]["reason_code"] == "evaluator_error"


# ─── threshold ───────────────────────────────────────────────────────────────────────────────────────────────────

def threshold_rule(**params):
    p = {"quantity": "test moisture", "operator": "gt", "value": 14.0, "unit": "%", "then": "Test moisture stated",
         "detect": {"term_keys": ["test_moisture"]}, **params}
    return Rule("TEST.T502.MOIST", 1, "threshold", "composition", "EU", "Synthetic threshold rule", p, {"all": []},
                "TEST Art. 3")


def test_threshold_fails_only_when_the_condition_holds_and_the_consequence_is_missing():
    wet = {**FACTS, "quantities": {"test moisture": {"value": 20, "unit": "%"}}}
    dry = {**FACTS, "quantities": {"test moisture": {"value": 10, "unit": "%"}}}
    assert check(panel("sv", line("Testfukt 20 %")), [threshold_rule()], facts=wet).label_state == "clear"
    res = check(panel("sv", line("Sammansättning")), [threshold_rule()], facts=wet)
    assert res.label_state == "action" and res.findings[0]["rule_key"] == "TEST.T502.MOIST"
    nothing = check(panel("sv", line("Sammansättning")), [threshold_rule()], facts=dry)
    assert nothing.applied == [] and nothing.withheld == [] and nothing.label_state == "not_assessed"


def test_threshold_without_the_quantity_in_its_unit_is_withheld_data_missing():
    for facts in (FACTS, {**FACTS, "quantities": {"test moisture": {"value": 200, "unit": "g/kg"}}}):
        res = check(panel("sv", line("Sammansättning")), [threshold_rule()], facts=facts)
        assert res.withheld == ["TEST.T502.MOIST"] and res.findings[0]["reason_code"] == "data_missing"
    k02 = threshold_rule(detect=None)                         # the K02 extraction carries no detect
    wet = {**FACTS, "quantities": {"test moisture": {"value": 20, "unit": "%"}}}
    assert check(panel("sv", line("x")), [k02], facts=wet).findings[0]["reason_code"] == "data_missing"
    bad = check(panel("sv", line("x")), [threshold_rule(operator="about")], facts=wet)
    assert bad.findings[0]["reason_code"] == "evaluator_error"


# ─── additive_condition ──────────────────────────────────────────────────────────────────────────────────────────

def additive_rule(check_name, **params):
    p = {"check": check_name, "additives": ["9z999"], **params}
    return Rule("TEST.T502.ADD", 1, "additive_condition", "composition", "EU", "Synthetic additive rule", p,
                {"all": []}, "TEST Art. 5")


def formula(amount=10.0, unit="mg/kg", *, species=("Test cats",), max_content=None, expiry="2099-01-01"):
    return {**FACTS, "today": dt.date(2026, 11, 2), "additives": [
        {"additive_ref": "9z999", "amount": amount, "unit": unit,
         "register": {"species": list(species), "max_content": max_content, "expiry": expiry}}]}


def test_additive_authorised_for_species_passes_only_on_an_exact_register_match_and_fails_when_expired():
    r = additive_rule("authorised_for_species", species_wordings={"cat": ["Test cats"]})
    p = panel("sv", line("x"))
    assert check(p, [r], facts=formula()).label_state == "clear"
    expired = check(p, [r], facts=formula(expiry="2020-01-01"))
    assert expired.label_state == "action" and "9z999" in expired.findings[0]["message"]
    unsplit = check(p, [r], facts=formula(species=("Test cats and test dogs",)))   # a miss proves nothing
    assert unsplit.withheld == ["TEST.T502.ADD"] and unsplit.findings[0]["reason_code"] == "data_missing"
    no_table = check(p, [additive_rule("authorised_for_species")], facts=formula())
    assert no_table.findings[0]["reason_code"] == "data_missing"


def test_additive_max_content_is_compared_only_in_the_same_unit_and_withheld_when_not_imported():
    p = panel("sv", line("x"))
    r = additive_rule("within_max_content")
    limit = {"value": 25, "unit": "mg/kg"}
    assert check(p, [r], facts=formula(10, max_content=limit)).label_state == "clear"
    assert check(p, [r], facts=formula(30, max_content=limit)).label_state == "action"
    for facts in (formula(10), formula(10, "g/kg", max_content=limit)):   # never imported; a unit never converted
        assert check(p, [r], facts=facts).findings[0]["reason_code"] == "data_missing"


def test_additive_declaration_and_absent_additives():
    p = panel("sv", line("x"))
    assert check(p, [additive_rule("declaration_required")], facts=formula()).findings[0]["reason_code"] == \
        "data_missing"
    absent = check(p, [additive_rule("within_max_content", additives=["0a000"])], facts=formula())
    assert absent.applied == [] and absent.withheld == []
    bad = check(p, [additive_rule("is_tasty")], facts=formula())
    assert bad.findings[0]["reason_code"] == "evaluator_error"


def test_additive_rule_is_withheld_when_no_formula_was_entered_never_not_applicable():
    """#172: a product with no formula lines carries no "additives" fact (None). Its additive rules are missing data,
    withheld data_missing, never dropped as not_applicable, so they can never let a label read Clear."""
    p = panel("sv", line("x"))
    none = check(p, [additive_rule("within_max_content")], facts={**FACTS, "additives": None})
    assert none.applied == [] and none.findings[0]["reason_code"] == "data_missing"
    # a formula that was entered and has no additive lines: the rule truly does not apply
    empty = check(p, [additive_rule("within_max_content")], facts={**FACTS, "additives": []})
    assert empty.applied == [] and empty.withheld == []


# ─── The fixtures runner ─────────────────────────────────────────────────────────────────────────────────────────

def test_the_runner_judges_character_height_fixtures():
    assert {"character_height", "threshold", "additive_condition"} <= set(fr.EVALUATORS)
    params = {"target": "Test weight", "height_definition": "x_height", "bands": BAND,
              "detect": {"term_keys": ["test_weight"]}}

    def fx(name, outcome, panel_data, expected=None):
        return fr.RuleFixture(name, "TEST.T502.HEIGHT", 1, "character_height", name,
                              {"panel": panel_data, "node": {"id": "EU-SE", "languages": ["sv"], "region": "EU"}},
                              outcome, expected, params, {"all": []}, {("test_weight", "sv"): ["Testvikt"]})

    fixtures = [
        fx("tall", "passed", {"language": "sv", "text_objects": [{"text": "Testvikt 1 kg", "x_height_mm": 2.4}]}),
        fx("short", "failed", {"language": "sv", "text_objects": [{"text": "Testvikt 1 kg", "x_height_mm": 1.1}]},
           {"findings": [{"rule_key": "TEST.T502.HEIGHT"}]}),
        fx("ocr", "withheld", {"language": "sv", "text_objects": [{"text": "Testvikt", "x_height_mm": 3,
                                                                    "is_ocr": True}]}, {"reason": "no_true_scale"}),
        fx("outlined", "withheld", {"language": "sv", "failure_code": "outlined_text"}, {"reason": "outlined_text"}),
    ]

    class Store:
        def members(self, rv):
            return [fr.Member("TEST.T502.HEIGHT", 1, "character_height")]

        def fixtures(self, rv):
            return fixtures

    assert [(r.item, r.result) for r in fr.run_rule_fixtures(Store(), "t502")] == [
        ("tall", "matched"), ("short", "matched"), ("ocr", "matched"), ("outlined", "matched")]
