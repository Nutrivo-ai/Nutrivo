"""engine.envelope without a database: each shape's envelope reading, and the honesty rules (E02). Synthetic rules
and terms only."""
from nutrivo_worker.engine.core import COVERAGE_DOMAINS, Coverage, Node, Rule
from nutrivo_worker.engine.envelope import OUT_OF_SCOPE, build_node

NODE = Node("EU-SE", ("sv",), "EU")
COMPLETE = [Coverage(d, "complete", None, None) for d in COVERAGE_DOMAINS]
FACTS = {"species": "dog", "life_stage": None, "product_class": None, "intended_use": None, "parnut_status": None,
         "format": "wet", "additives": []}
TERMS = {("t_net", "sv"): ("Nettovikt",)}


def rule(key, shape, params, applicability=None):
    return Rule(key, 1, shape, "mandatory_particulars", "EU", f"Synthetic {key}", params,
                applicability or {"all": []}, "TEST Art. 3")


def test_E02_main_threshold_and_character_height_are_stated_in_the_register_wording():
    """[E02.main] A threshold is an obligation and a character height a requirement, with the term in sv."""
    env = build_node(NODE, [
        rule("T.THR", "threshold", {"quantity": "net", "operator": "gt", "value": 100, "unit": "g", "then": "x",
                                    "detect": {"term_keys": ["t_net"]}}),
        rule("T.HGT", "character_height", {"height_definition": "x_height",
                                           "bands": [{"quantity_from": None, "quantity_to": None,
                                                      "min_height_mm": 1.2}],
                                           "detect": {"term_keys": ["t_net"]}})], COMPLETE, TERMS, FACTS)
    kinds = {(i["rule_key"], i["kind"]) for i in env.items}
    assert kinds == {("T.THR", "obligation"), ("T.HGT", "requirement")}
    assert all(i["payload"]["wordings"] == ["Nettovikt"] and i["language"] == "sv" for i in env.items)
    assert env.state == "clear"


def test_E02_must_1_unknown_applicability_missing_links_and_unknown_shapes_are_withheld():
    """[E02.must.1] Never answered by default: each is a not_assessed item with a reason, and the market is not
    clear."""
    env = build_node(NODE, [
        rule("T.UNK", "mandatory_particular", {"detect": {"term_keys": ["t_net"]}}, {"eq": ["product_class", "x"]}),
        rule("T.NOLINK", "prescribed_wording", {"wordings": ["source text"]}),
        rule("T.NEW", "some_future_shape", {}),
        rule("T.BAD", "mandatory_particular", {}, {"nope": []})], COMPLETE, TERMS, FACTS)
    reasons = {i["rule_key"]: i["reason_code"] for i in env.items}
    assert reasons == {"T.UNK": "data_missing", "T.NOLINK": "data_missing", "T.NEW": "evaluator_missing",
                       "T.BAD": "evaluator_error"}
    assert all(i["kind"] == "not_assessed" and i["provenance"] == "not_assessed" for i in env.items)
    assert env.state == "not_assessed" and env.withheld == 4


def test_E02_must_1_a_missing_coverage_row_keeps_the_market_not_assessed_without_inventing_a_gap():
    """[E02.must.1] Five complete domains and no registration row: not clear, and no item without a gap_id."""
    env = build_node(NODE, [rule("T.HGT", "mandatory_particular", {"detect": {"term_keys": ["t_net"]}})],
                     COMPLETE[:-1], TERMS, FACTS)
    assert env.state == "not_assessed" and all(i["rule_key"] or i["gap_id"] for i in env.items)


def test_E02_must_2_nutrient_adequacy_is_always_out_of_scope():
    """[E02.must.2] Until FEDIAF is licensed."""
    assert OUT_OF_SCOPE == ("nutrient_adequacy",)
