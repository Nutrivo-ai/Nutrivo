"""E02 on real Postgres and pgmq: app.request_envelope enqueues, the envelope job runs through the job loop, and the
envelope, its items and its markets are written in one transaction from accepted rules only.

Everything runs in one transaction that is rolled back. Rules, terms, register rows and the ruleset are synthetic
(TEST.T1002.*, T1002-*), never law."""
import uuid

import pytest
from psycopg.types.json import Jsonb
from test_check_pg import DOMAINS, one, pg_conn

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore
from nutrivo_worker.engine.envelope_store import PgEnvelopeStore
from nutrivo_worker.handlers import envelope as envelope_handler
from nutrivo_worker.jobs import Job, JobContext, Registry, process_message

S = Settings(max_attempts=5, stale_after_s=900)
DOG = {"eq": ["species", "dog"]}


@pytest.fixture
def conn():
    yield from pg_conn()


def rule(conn, rv, person, key, shape, domain, params, applicability=DOG, node="EU"):
    conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values (%s, %s, %s, %s, %s)"
                 " on conflict do nothing", (key, shape, domain, node, f"Synthetic {key}"))
    conn.execute("insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref,"
                 " source_excerpt, accepted_by, accepted_at) values (%s, 1, 'accepted', %s, %s, 'TEST Art. 2',"
                 " 'synthetic', %s, now()) on conflict do nothing", (key, Jsonb(params), Jsonb(applicability), person))
    conn.execute("insert into ref.ruleset_members (ruleset_version, rule_key, version) values (%s, %s, 1)", (rv, key))


def seed(conn, rv="T1002-MAIN", *, extra_rules=(), amount=10):
    """A brief for dogs in EU-SE (fully encoded) and EU-DK (composition not encoded, and no Danish terms)."""
    tag = uuid.uuid4().hex[:8]
    user = one(conn, "insert into auth.users (id, email) values (gen_random_uuid(), %s) returning id",
               f"t1002-{tag}@example.test")["id"]
    person = one(conn, "insert into app.people (user_id, display_name, email) values (%s, 'T-1002 editor', %s)"
                       " returning id", user, f"t1002-{tag}@example.test")["id"]
    ws = one(conn, "insert into app.workspaces (name, created_by) values ('T-1002', %s) returning id", person)["id"]
    conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, 'editor')", (ws, person))
    family = one(conn, "insert into app.families (workspace_id, name) values (%s, 'Senior') returning id", ws)["id"]
    product = one(conn, "insert into app.products (workspace_id, family_id, name, stage, species, life_stage, format)"
                        " values (%s, %s, 'Senior brief', 'brief', 'dog', 'senior', 'wet') returning id",
                  ws, family)["id"]
    for node in ("EU-SE", "EU-DK"):
        conn.execute("insert into app.product_nodes (product_id, node_id, workspace_id) values (%s, %s, %s)",
                     (product, node, ws))
    conn.execute("insert into ref.feed_materials (number, names) values ('TEST.T1002.1', '{\"en\": \"Test chicken\"}')"
                 " on conflict do nothing")
    conn.execute("insert into ref.feed_additives (id, name, species, max_content, expiry) values ('TEST-T1002-A',"
                 " 'Test zinc', '{\"Test dogs\"}', '{\"value\": 25, \"unit\": \"mg/kg\"}', '2099-01-01')"
                 " on conflict do nothing")
    conn.execute("insert into app.formula_lines (workspace_id, product_id, position, ingredient, percent,"
                 " feed_material_ref, additive_ref, amount, unit) values"
                 " (%s, %s, 1, 'Test chicken', 60, 'TEST.T1002.1', null, null, null),"
                 " (%s, %s, 2, 'Test zinc', null, null, 'TEST-T1002-A', %s, 'mg/kg')",
                 (ws, product, ws, product, amount))

    conn.execute("insert into ref.ruleset_versions (id, released_at) values (%s, now() + interval '1 minute')", (rv,))
    rule(conn, rv, person, "TEST.T1002.BATCH", "mandatory_particular", "mandatory_particulars",
         {"particular": "Test batch", "detect": {"term_keys": ["t1002_batch"]}})
    rule(conn, rv, person, "TEST.T1002.DESIG", "prescribed_wording", "claims_wording",
         {"term_key": "t1002_designation"})
    rule(conn, rv, person, "TEST.T1002.MAX", "additive_condition", "composition",
         {"check": "within_max_content", "additives": ["TEST-T1002-A"]})
    rule(conn, rv, person, "TEST.T1002.AUTH", "additive_condition", "composition",
         {"check": "authorised_for_species", "species_wordings": {"dog": ["Test dogs"]}})
    rule(conn, rv, person, "TEST.T1002.CATS", "mandatory_particular", "mandatory_particulars",
         {"detect": {"term_keys": ["t1002_batch"]}}, applicability={"eq": ["species", "cat"]})
    for args in extra_rules:
        rule(conn, rv, person, *args)
    for key, term in (("t1002_batch", "Testparti"), ("t1002_designation", "Testfoder för hundar")):
        conn.execute("insert into ref.term_entries (term_key, language, term, kind, article_ref, status,"
                     " ruleset_version) values (%s, 'sv', %s, 'heading', 'TEST', 'accepted', %s)", (key, term, rv))
    conn.execute("insert into ref.coverage_gaps (gap_id, node_id, domain, reason_code, description) values"
                 " ('GAP-T1002-DK-COMP', 'EU-DK', 'composition', 'not_encoded', 'synthetic') on conflict do nothing")
    for node in ("EU-SE", "EU-DK"):
        for d in DOMAINS:
            gap = node == "EU-DK" and d == "composition"
            conn.execute("insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded,"
                         " gap_id) values (%s, %s, %s, %s, %s, %s)",
                         (rv, node, d, "not_encoded" if gap else "complete", 0 if gap else 1,
                          "GAP-T1002-DK-COMP" if gap else None))
    return {"user": str(user), "person": str(person), "ws": str(ws), "product": str(product)}


def as_editor(conn, s, sql, *args):
    with conn.transaction():
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{s["user"]}","role":"authenticated"}}',))
        conn.execute("set local role authenticated")
        row = one(conn, sql, *args)
        conn.execute("reset role")
    return row


def request(conn, s):
    return str(as_editor(conn, s, "select app.request_envelope(%s) as id", s["product"])["id"])


def run_job(conn, job_id):
    store = PgStore(conn)
    reg = Registry()
    reg.register("envelope")(envelope_handler.envelope)
    msgs = [m for m in store.read("envelope", 30, 50) if m.job_id == job_id]
    assert len(msgs) == 1
    return process_message(store, reg, msgs[0], S)


def envelope_of(conn, job_id):
    return one(conn, "select * from app.envelopes where job_id = %s", job_id)


def items_of(conn, env_id, node=None):
    return conn.execute("select * from app.envelope_items where envelope_id = %s and (%s::text is null or node_id = %s)"
                        " order by node_id, rule_key nulls first, language, kind",
                        (env_id, node, node)).fetchall()


def states_of(conn, env_id):
    return {r["node_id"]: r["state"] for r in conn.execute(
        "select node_id, state from app.envelope_nodes where envelope_id = %s", (env_id,)).fetchall()}


def test_E02_main_compute_the_compliance_envelope_end_to_end(conn):
    """[E02.main] request_envelope enqueues; the job writes the envelope from accepted rules: required particulars
    and permitted wording in the market's language from the term register, additive limits and authorisation from
    the formula, pinned to the ruleset and inputs_hash. A second delivery and a second request write nothing."""
    s = seed(conn)
    job_id = request(conn, s)
    assert run_job(conn, job_id) == "succeeded"

    env = envelope_of(conn, job_id)
    job = one(conn, "select payload, progress from app.jobs where id = %s", job_id)
    assert (env["ruleset_version"], env["inputs_hash"], env["node_ids"]) == (
        "T1002-MAIN", job["payload"]["inputs_hash"], ["EU-DK", "EU-SE"])
    assert states_of(conn, env["id"])["EU-SE"] == "clear"
    se = {(i["rule_key"], i["kind"]): i for i in items_of(conn, env["id"], "EU-SE")}
    assert set(se) == {("TEST.T1002.AUTH", "permitted"), ("TEST.T1002.BATCH", "requirement"),
                       ("TEST.T1002.DESIG", "permitted"), ("TEST.T1002.MAX", "limit")}
    batch = se[("TEST.T1002.BATCH", "requirement")]
    assert (batch["language"], batch["payload"]["wordings"], batch["provenance"], batch["citation"],
            batch["rule_version"]) == ("sv", ["Testparti"], "deterministic_rule", "TEST Art. 2", 1)
    assert se[("TEST.T1002.DESIG", "permitted")]["payload"]["wordings"] == ["Testfoder för hundar"]
    limit = se[("TEST.T1002.MAX", "limit")]
    assert (limit["language"], limit["payload"]["outcome"], limit["payload"]["max_content"],
            limit["payload"]["amount"]) == (None, "within", {"value": 25, "unit": "mg/kg"}, 10)
    assert job["progress"]["outcome"] == "computed"
    assert one(conn, "select count(*) as n from app.audit_events where kind = 'envelope.computed'"
                     " and object_id = %s", s["product"])["n"] == 1

    # Cached by inputs_hash: the same request returns the same job; a rerun of the job writes nothing more.
    assert request(conn, s) == job_id
    jrow = one(conn, "select workspace_id, payload from app.jobs where id = %s", job_id)
    job_obj = Job(job_id, "envelope", str(jrow["workspace_id"]), jrow["payload"], 2)
    n_items = len(items_of(conn, env["id"]))
    envelope_handler.run_envelope(job_obj, JobContext(job_obj, PgStore(conn), S), PgEnvelopeStore(conn))
    assert one(conn, "select count(*) as n from app.envelopes where product_id = %s", s["product"])["n"] == 1
    assert len(items_of(conn, env["id"])) == n_items


def test_E02_main_an_additive_over_its_ceiling_is_an_action_for_the_market(conn):
    """[E02.main] The brief's amount above the register's max content is a limit the market exceeds."""
    s = seed(conn, "T1002-OVER", amount=40)
    job_id = request(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    env = envelope_of(conn, job_id)
    assert states_of(conn, env["id"])["EU-SE"] == "action"
    [lim] = [i for i in items_of(conn, env["id"], "EU-SE") if i["kind"] == "limit"]
    assert lim["payload"]["outcome"] == "exceeds"
    assert one(conn, "select open_items from app.envelope_nodes where envelope_id = %s and node_id = 'EU-SE'",
               env["id"])["open_items"] == 1


def test_E02_must_1_anything_not_encoded_is_withheld_with_its_gap(conn):
    """[E02.must.1] EU-DK's composition domain is not encoded: a not_assessed item names its gap; rules with no
    Danish register term are withheld data_missing (never the Swedish wording); claim rules are withheld
    claim_not_evaluated with no model call. The market is not_assessed, never clear."""
    s = seed(conn, "T1002-GAP", extra_rules=[("TEST.T1002.CLAIM", "claim_judgement", "claims_wording",
                                               {"question": "synthetic", "min_confidence": 0.9})])
    job_id = request(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    env = envelope_of(conn, job_id)
    assert states_of(conn, env["id"]) == {"EU-SE": "not_assessed", "EU-DK": "not_assessed"}
    dk = items_of(conn, env["id"], "EU-DK")
    gap = [i for i in dk if i["gap_id"]]
    assert [(i["gap_id"], i["kind"], i["provenance"], i["reason_code"]) for i in gap] == [
        ("GAP-T1002-DK-COMP", "not_assessed", "not_assessed", "not_encoded")]
    withheld = {(i["rule_key"], i["reason_code"]) for i in dk if i["rule_key"] and i["kind"] == "not_assessed"}
    assert ("TEST.T1002.BATCH", "data_missing") in withheld and ("TEST.T1002.DESIG", "data_missing") in withheld
    assert ("TEST.T1002.CLAIM", "claim_not_evaluated") in withheld
    assert not any(i["kind"] in ("requirement", "permitted") and i["language"] == "da" for i in dk)
    assert one(conn, "select count(*) as n from app.model_calls where workspace_id = %s", s["ws"])["n"] == 0
    # Every item carries a rule_key or a gap_id; nothing claims model judgement.
    assert all((i["rule_key"] or i["gap_id"]) and i["provenance"] != "model_judgement"
               for i in items_of(conn, env["id"]))


def test_E02_must_1_an_unmatched_formula_line_withholds_every_additive_rule(conn):
    """[E02.must.1] A line matched to no register row may be an additive: additive rules are withheld, not passed."""
    s = seed(conn, "T1002-UNMATCHED")
    conn.execute("insert into app.formula_lines (workspace_id, product_id, position, ingredient) values"
                 " (%s, %s, 3, 'Botanical blend 4B')", (s["ws"], s["product"]))
    job_id = request(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    env = envelope_of(conn, job_id)
    add = [i for i in items_of(conn, env["id"], "EU-SE") if i["rule_key"] in ("TEST.T1002.MAX", "TEST.T1002.AUTH")]
    assert add and all((i["kind"], i["reason_code"]) == ("not_assessed", "data_missing") for i in add)
    assert states_of(conn, env["id"])["EU-SE"] == "not_assessed"


def test_E02_must_2_nutrient_adequacy_stays_out_of_scope(conn):
    """[E02.must.2] A formula with nutrient levels gets no adequacy answer: the envelope records nutrient adequacy
    as out of scope, and no item reads a formula percentage."""
    s = seed(conn, "T1002-NUTRIENT")
    conn.execute("update app.formula_lines set percent = 28 where product_id = %s and position = 1", (s["product"],))
    job_id = request(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    env = envelope_of(conn, job_id)
    assert env["out_of_scope"] == ["nutrient_adequacy"]
    items = items_of(conn, env["id"])
    assert not any("percent" in i["payload"] or "adequacy" in str(i["payload"]).lower() for i in items)
    assert {i["kind"] for i in items} <= {"requirement", "permitted", "prohibited", "limit", "obligation",
                                          "not_assessed"}


def test_E02_main_a_job_whose_inputs_changed_writes_nothing(conn):
    """[E02.main] The formula changed after the request: the job is superseded by the newer request's own job."""
    s = seed(conn, "T1002-STALE")
    job_id = request(conn, s)
    conn.execute("update app.formula_lines set amount = 12 where product_id = %s and position = 2", (s["product"],))
    assert run_job(conn, job_id) == "succeeded"
    assert envelope_of(conn, job_id) is None
    assert one(conn, "select progress from app.jobs where id = %s", job_id)["progress"]["outcome"] == "superseded"
    newer = request(conn, s)
    assert newer != job_id and run_job(conn, newer) == "succeeded" and envelope_of(conn, newer) is not None

    # Back to the first inputs: the superseded job is queued again and now computes its envelope.
    conn.execute("update app.formula_lines set amount = 10 where product_id = %s and position = 2", (s["product"],))
    assert request(conn, s) == job_id
    assert run_job(conn, job_id) == "succeeded" and envelope_of(conn, job_id) is not None
