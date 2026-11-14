"""T-903 · the recheck planner (J05) without Postgres: which rules a scoped re-check evaluates, and how the carried
outcomes merge with the fresh ones. tests/test_recheck_pg.py runs the whole job on the local stack."""
from nutrivo_worker.engine.core import CheckResult, Coverage, Panel, Rule
from nutrivo_worker.handlers.recheck import BaseCheck, merge, split_rules, term_keys

DOMAINS = ("mandatory_particulars", "composition", "claims_wording", "type_geometry", "language", "registration")
COMPLETE = [Coverage(d, "complete", None, None) for d in DOMAINS]
PANEL = Panel(0, "sv", "extracted", id="p1")


def rule(key, version=1, params=None):
    return Rule(key, version, "prescribed_wording", "claims_wording", "EU-SE", "t", params or {}, {"all": []}, "Art")


def test_term_keys_collects_every_linked_register_key():
    assert term_keys({"term_key": "a", "alternative_term_keys": ["b"], "detect": {"term_keys": ["c"]},
                      "other": [{"term_key": "d"}], "wordings": ["not a key"]}) == {"a", "b", "c", "d"}


def test_J05_must_1_only_a_changed_member_or_a_changed_linked_term_is_evaluated():
    target = [rule("SAME", 1, {"term_key": "x"}), rule("BUMPED", 2), rule("NEW", 1), rule("TERMS", 1, {"term_key": "t"})]
    base_members = {"SAME": 1, "BUMPED": 1, "TERMS": 1, "GONE": 1}
    base_terms = {("x", "sv"): ("X",), ("t", "sv"): ("Old",)}
    target_terms = {("x", "sv"): ("X",), ("t", "sv"): ("New",)}
    changed, unchanged = split_rules(target, base_members, target_terms, base_terms)
    assert sorted(r.rule_key for r in changed) == ["BUMPED", "NEW", "TERMS"]
    assert unchanged == {"SAME"}                       # GONE is in neither: a withdrawn rule is simply dropped


def test_J05_merge_carries_unchanged_outcomes_and_recomputes_the_label_state():
    base = BaseCheck("c0", PANEL, applied=["KEEP", "OLD", "GONE"], passed=["KEEP", "OLD"], withheld=["HELD"],
                     findings=[{"rule_key": "GONE", "state": "action"},
                               {"rule_key": "HELD", "state": "not_assessed", "reason_code": "data_missing"},
                               {"rule_key": None, "gap_id": "G", "state": "not_assessed"}])
    fresh = CheckResult("EU-SE", PANEL, "action", applied=["OLD"], passed=[],
                        findings=[{"rule_key": "OLD", "state": "action"}])
    out = merge(fresh, base, {"KEEP", "HELD"}, COMPLETE)
    assert out.applied == ["KEEP", "OLD"] and out.passed == ["KEEP"] and out.withheld == ["HELD"]
    assert [f["rule_key"] for f in out.findings] == ["OLD", "HELD"]   # GONE dropped, the old gap not carried
    assert out.label_state == "action"


def test_J05_merge_never_clears_on_incomplete_coverage_or_a_carried_withhold():
    base = BaseCheck("c0", PANEL, applied=["KEEP"], passed=["KEEP"], withheld=[], findings=[])
    fresh = CheckResult("EU-SE", PANEL, "clear", applied=["NEW"], passed=["NEW"])
    assert merge(fresh, base, {"KEEP"}, COMPLETE).label_state == "clear"
    partial = [c if c.domain != "claims_wording" else Coverage(c.domain, "partial", "G", None) for c in COMPLETE]
    assert merge(fresh, base, {"KEEP"}, partial).label_state == "not_assessed"
    assert merge(fresh, base, {"KEEP"}, COMPLETE[:-1]).label_state == "not_assessed"   # a domain with no row
    held = BaseCheck("c0", PANEL, applied=[], passed=[], withheld=["KEEP"],
                     findings=[{"rule_key": "KEEP", "state": "not_assessed", "reason_code": "model_abstained"}])
    assert merge(fresh, held, {"KEEP"}, COMPLETE).label_state == "not_assessed"   # abstention stays withheld
