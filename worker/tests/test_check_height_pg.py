"""D05 on real Postgres: a character_height rule runs through app.request_check and the check job, and its finding
carries bbox, measured_mm, required_mm and height_definition (contract 2). Rolled back at the end, like
test_check_pg. Rules, terms and bands are synthetic (TEST.T502.*, T502-*), never law."""
import pytest
from psycopg.types.json import Jsonb
from test_check_pg import checks_of, findings_of, one, pg_conn, request_check, run_job, seed_product, seed_ruleset

HEIGHT = {"target": "Test weight", "height_definition": "x_height", "detect": {"term_keys": ["test_weight"]},
          "bands": [{"quantity_from": None, "quantity_to": None, "quantity_unit": "g", "min_height_mm": 2.0}]}


@pytest.fixture
def conn():
    yield from pg_conn()


def add_height_rule(conn, rv, person):
    conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values ('TEST.T502.HEIGHT',"
                 " 'character_height', 'type_geometry', 'EU-SE', 'Synthetic height rule') on conflict do nothing")
    conn.execute("insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref,"
                 " source_excerpt, accepted_by, accepted_at) values ('TEST.T502.HEIGHT', 1, 'accepted', %s,"
                 " '{\"all\": []}', 'TEST Art. 9', 'synthetic', %s, now()) on conflict do nothing",
                 (Jsonb(HEIGHT), person))
    conn.execute("insert into ref.ruleset_members (ruleset_version, rule_key, version) values (%s,"
                 " 'TEST.T502.HEIGHT', 1)", (rv,))
    conn.execute("insert into ref.term_entries (term_key, language, term, kind, article_ref, status, ruleset_version)"
                 " values ('test_weight', 'sv', 'Testvikt', 'heading', 'TEST', 'accepted', %s)", (rv,))


def add_weight_line(conn, s, x_mm, cap_mm):
    return str(one(conn, "insert into app.text_objects (workspace_id, product_id, panel_id, text, bbox_mm,"
                         " x_height_mm, cap_height_mm, reading_order) values (%s, %s, %s, 'Testvikt 400 g',"
                         " '{3,40,33,46}', %s, %s, 9) returning id",
                   s["ws"], s["product"], s["panels"]["sv"], x_mm, cap_mm)["id"])


def test_D05_main_check_type_size_end_to_end(conn):
    """[D05.main] The x-height measured by the extraction is below the band minimum: the Swedish check is action and
    its finding carries the text object, bbox, measured_mm, required_mm and height_definition."""
    s = seed_product(conn)
    seed_ruleset(conn, "T502-MAIN", s["person"])
    add_height_rule(conn, "T502-MAIN", s["person"])
    text_id = add_weight_line(conn, s, 1.62, 2.31)
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"

    sv = next(c for c in checks_of(conn, job_id) if c["language"] == "sv")
    assert sv["label_state"] == "action" and "TEST.T502.HEIGHT" in sv["applied_rule_keys"]
    assert "TEST.T502.HEIGHT" not in sv["passed_rule_keys"]
    [f] = [f for f in findings_of(conn, job_id) if f["rule_key"] == "TEST.T502.HEIGHT"]
    assert (f["state"], f["provenance"], f["citation"], f["language"]) == ("action", "deterministic_rule",
                                                                          "TEST Art. 9", "sv")
    assert (str(f["text_object_id"]), [float(x) for x in f["bbox_mm"]]) == (text_id, [3.0, 40.0, 33.0, 46.0])
    assert (float(f["measured_mm"]), float(f["required_mm"]), f["height_definition"]) == (1.62, 2.0, "x_height")


def test_D05_main_a_tall_enough_figure_passes(conn):
    """[D05.main] At or above the minimum the rule passes and the market is clear on that panel."""
    s = seed_product(conn)
    seed_ruleset(conn, "T502-PASS", s["person"])
    add_height_rule(conn, "T502-PASS", s["person"])
    add_weight_line(conn, s, 2.05, 2.9)
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    sv = next(c for c in checks_of(conn, job_id) if c["language"] == "sv")
    assert sv["label_state"] == "clear" and "TEST.T502.HEIGHT" in sv["passed_rule_keys"]
