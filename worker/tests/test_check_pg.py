"""D04 on real Postgres and pgmq: app.request_check enqueues, the check job runs through the job loop, and the
checks, findings and product markets are written in one transaction.

Everything runs in one transaction that is rolled back: checks and findings are insert-only and the gate tests
assume an empty tenant dataset. Rules, terms and the ruleset are synthetic (TEST.T403.*, T403-*), never law."""
import uuid

import psycopg
import pytest
from pgtest import DSN, skip_no_database
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore
from nutrivo_worker.engine.core import CheckResult
from nutrivo_worker.engine.store import NoReleasedRuleset, PgCheckStore
from nutrivo_worker.handlers import check as check_handler
from nutrivo_worker.jobs import Job, JobContext, Registry, process_message

S = Settings(max_attempts=5, stale_after_s=900)
DOMAINS = ("mandatory_particulars", "composition", "claims_wording", "type_geometry", "language", "registration")


@pytest.fixture
def conn():
    try:
        c = psycopg.connect(DSN, row_factory=dict_row, connect_timeout=10)   # not autocommit: rolled back below
    except psycopg.OperationalError:
        skip_no_database()
    if c.execute("select to_regnamespace('pgmq') is not null as ok").fetchone()["ok"] is False:
        c.close()
        skip_no_database("pgmq is not installed in this database")
    yield c
    c.rollback()
    c.close()


def one(conn, q, *a):
    return conn.execute(q, a).fetchone()


def seed_ruleset(conn, rv, person, *, complete=True):
    """A synthetic released ruleset: a batch particular held on EU, a designation wording held on EU-SE, Swedish
    and English synthetic terms, and EU-SE coverage complete (or the claims domain partial with its gap)."""
    conn.execute("insert into ref.ruleset_versions (id, notes) values (%s, 'T-403 synthetic test ruleset')", (rv,))
    for key, shape, node, domain, params in (
            ("TEST.T403.BATCH", "mandatory_particular", "EU", "mandatory_particulars",
             {"particular": "Test batch", "detect": {"term_keys": ["test_batch"]}}),
            ("TEST.T403.DESIG", "prescribed_wording", "EU-SE", "claims_wording", {"term_key": "test_designation"})):
        conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values (%s, %s, %s, %s,"
                     " 'Synthetic test rule') on conflict do nothing", (key, shape, domain, node))
        conn.execute("insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref,"
                     " source_excerpt, accepted_by, accepted_at) values (%s, 1, 'accepted', %s,"
                     " '{\"eq\": [\"species\", \"cat\"]}', 'TEST Art. 1', 'synthetic', %s, now())"
                     " on conflict do nothing", (key, Jsonb(params), person))
        conn.execute("insert into ref.ruleset_members (ruleset_version, rule_key, version) values (%s, %s, 1)",
                     (rv, key))
    for key, lang, term in (("test_batch", "sv", "Testparti"), ("test_batch", "en", "Test lot"),
                            ("test_designation", "sv", "Testfoder för katter"),
                            ("test_designation", "en", "Test food for cats")):
        conn.execute("insert into ref.term_entries (term_key, language, term, kind, article_ref, status,"
                     " ruleset_version) values (%s, %s, %s, 'heading', 'TEST', 'accepted', %s)", (key, lang, term, rv))
    for d in DOMAINS:
        partial = not complete and d == "claims_wording"
        conn.execute("insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, gap_id)"
                     " values (%s, 'EU-SE', %s, %s, 1, %s)",
                     (rv, d, "partial" if partial else "complete", f"GAP-EU-SE-{d.upper()}" if partial else None))


def seed_product(conn, *, sv_texts=("Testfoder för katter", "Testparti: L1"), confirmed=True):
    tag = uuid.uuid4().hex[:8]
    user = one(conn, "insert into auth.users (id, email) values (gen_random_uuid(), %s) returning id",
               f"t403-{tag}@example.test")["id"]
    person = one(conn, "insert into app.people (user_id, display_name, email) values (%s, 'T-403 editor', %s)"
                       " returning id", user, f"t403-{tag}@example.test")["id"]
    ws = one(conn, "insert into app.workspaces (name, created_by) values ('T-403', %s) returning id", person)["id"]
    conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, 'editor')", (ws, person))
    family = one(conn, "insert into app.families (workspace_id, name) values (%s, 'Adult') returning id", ws)["id"]
    product = one(conn, "insert into app.products (workspace_id, family_id, name, stage, species, format)"
                        " values (%s, %s, 'Test cat food', 'active', 'cat', 'dry') returning id", ws, family)["id"]
    conn.execute("insert into app.product_nodes (product_id, node_id, workspace_id) values (%s, 'EU-SE', %s)",
                 (product, ws))
    av = one(conn, "insert into app.artwork_versions (workspace_id, product_id, version, file_sha256, storage_path,"
                   " is_new_artwork) values (%s, %s, 1, %s, 'x.pdf', true) returning id",
             ws, product, "a" * 64)["id"]
    run = one(conn, "insert into app.extraction_runs (workspace_id, product_id, artwork_version_id, engine,"
                    " engine_version, status, idempotency_key, finished_at) values (%s, %s, %s, 'test', '1',"
                    " 'succeeded', %s, now()) returning id", ws, product, av, f"t403:{tag}")["id"]
    panels = {}
    for i, (lang, texts) in enumerate((("sv", sv_texts), ("en", ("Test food for cats", "Test lot: L1")))):
        pid = one(conn, "insert into app.artwork_panels (workspace_id, product_id, artwork_version_id,"
                        " extraction_run_id, page, panel_index, bbox_mm, language, status) values (%s, %s, %s, %s,"
                        " 0, %s, '{0,0,70,100}', %s, 'extracted') returning id", ws, product, av, run, i, lang)["id"]
        panels[lang] = str(pid)
        for n, t in enumerate(texts):
            conn.execute("insert into app.text_objects (workspace_id, product_id, panel_id, text, bbox_mm,"
                         " reading_order) values (%s, %s, %s, %s, '{1,1,2,2}', %s)", (ws, product, pid, t, n))
    conn.execute("insert into app.classifications (workspace_id, product_id, species, life_stage, product_class,"
                 " citation, provenance, confirmed_by, confirmed_at) values (%s, %s, 'cat', 'adult', 'complete',"
                 " 'test', 'person', %s, case when %s then now() end)", (ws, product, person, confirmed))
    return {"user": str(user), "person": str(person), "ws": str(ws), "product": str(product), "av": str(av),
            "panels": panels}


def request_check(conn, s):
    """app.request_check as the editor, through RLS and the RPC's own permission check."""
    with conn.transaction():          # a savepoint: on an error it also undoes the role and the claims
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{s["user"]}","role":"authenticated"}}',))
        conn.execute("set local role authenticated")
        job_id = str(one(conn, "select app.request_check(%s) as id", s["product"])["id"])
        conn.execute("reset role")
    return job_id


def run_job(conn, job_id):
    store = PgStore(conn)
    reg = Registry()
    reg.register("check")(check_handler.check)
    msgs = [m for m in store.read("check", 30, 50) if m.job_id == job_id]
    assert len(msgs) == 1 and msgs[0].body == {"job_id": job_id}
    return process_message(store, reg, msgs[0], S)


def checks_of(conn, job_id):
    return conn.execute("select * from app.checks where job_id = %s order by language", (job_id,)).fetchall()


def findings_of(conn, job_id):
    return conn.execute("select f.* from app.check_findings f join app.checks c on c.id = f.check_id"
                        " where c.job_id = %s order by f.language, f.rule_key", (job_id,)).fetchall()


def test_D04_main_run_a_check_end_to_end(conn):
    """[D04.main] request_check enqueues; the job writes one check per market × panel with its findings, pins the
    ruleset and artwork hash, updates the market, and a second delivery writes nothing."""
    s = seed_product(conn, sv_texts=("Testfoder för katter",))          # the Swedish panel lacks the batch
    seed_ruleset(conn, "T403-MAIN", s["person"])
    job_id = request_check(conn, s)
    job = one(conn, "select payload, requested_by from app.jobs where id = %s", job_id)
    assert job["payload"]["ruleset_version"] == "T403-MAIN" and job["payload"]["node_ids"] == ["EU-SE"]

    assert run_job(conn, job_id) == "succeeded"

    en, sv = checks_of(conn, job_id)
    assert (en["language"], sv["language"]) == ("en", "sv")
    for c in (en, sv):
        assert (c["ruleset_version"], c["artwork_sha"], c["artwork_version_id"]) == ("T403-MAIN", "a" * 64,
                                                                                  uuid.UUID(s["av"]))
        assert str(c["actor_id"]) == s["person"] and c["actor_is_external"] is False
        assert c["classification_id"] is not None
    assert str(sv["panel_id"]) == s["panels"]["sv"]
    assert sv["label_state"] == "action"
    assert sv["applied_rule_keys"] == ["TEST.T403.BATCH", "TEST.T403.DESIG"]
    assert sv["passed_rule_keys"] == ["TEST.T403.DESIG"] and sv["withheld_rule_keys"] == []
    # The English panel is in no language of the Swedish market: its rules do not apply, and it is never clear.
    assert en["applied_rule_keys"] == [] and en["label_state"] == "not_assessed"
    [f] = findings_of(conn, job_id)
    assert (f["rule_key"], f["rule_version"], f["state"], f["provenance"], f["language"], f["citation"]) == (
        "TEST.T403.BATCH", 1, "action", "deterministic_rule", "sv", "TEST Art. 1")
    pn = one(conn, "select label_state, ruleset_version, open_actions, last_check_job_id from app.product_nodes"
                   " where product_id = %s", s["product"])
    assert (pn["label_state"], pn["ruleset_version"], pn["open_actions"], str(pn["last_check_job_id"])) == (
        "action", "T403-MAIN", 1, job_id)
    progress = one(conn, "select progress from app.jobs where id = %s", job_id)["progress"]
    assert progress == {"outcome": "checked", "checks": 2, "action": 1, "not_assessed": 1, "clear": 0}
    assert one(conn, "select count(*) as n from app.audit_events where kind = 'check.completed' and object_id = %s",
               job_id)["n"] == 1

    # Idempotent: the same job run again (a retry after a lost acknowledgement) writes nothing more.
    jrow = one(conn, "select id, kind, workspace_id, payload from app.jobs where id = %s", job_id)
    job = Job(job_id, "check", str(jrow["workspace_id"]), jrow["payload"], 2)
    results = check_handler.run_check(job, JobContext(job, PgStore(conn), S), PgCheckStore(conn))
    assert len(results) == 2 and len(checks_of(conn, job_id)) == 2 and len(findings_of(conn, job_id)) == 1
    assert one(conn, "select progress from app.jobs where id = %s", job_id)["progress"]["outcome"] == "checked"


def test_D04_main_a_fully_encoded_market_with_every_rule_passed_is_clear(conn):
    """[D04.main] Clear only where coverage is complete and every applied rule passed."""
    s = seed_product(conn)
    seed_ruleset(conn, "T403-CLEAR", s["person"])
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    sv = next(c for c in checks_of(conn, job_id) if c["language"] == "sv")
    assert sv["label_state"] == "clear" and sv["passed_rule_keys"] == sv["applied_rule_keys"]
    assert one(conn, "select display_state from app.product_nodes where product_id = %s", s["product"])[
        "display_state"] == "not_assessed"          # the English panel, and an unknown registration, are not clear


def test_D04_must_1_no_rule_no_verdict_is_enforced_by_the_database(conn):
    """[D04.must.1] With the claims domain partial, the market is not clear and the gap is named. A check forced
    to clear is refused by private.verdict_guard (P0021) and nothing of the job is written."""
    s = seed_product(conn)
    seed_ruleset(conn, "T403-PARTIAL", s["person"], complete=False)
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    sv = next(c for c in checks_of(conn, job_id) if c["language"] == "sv")
    assert sv["label_state"] == "not_assessed" and sv["passed_rule_keys"] == sv["applied_rule_keys"]
    gaps = [f for f in findings_of(conn, job_id) if f["gap_id"]]
    assert {(f["gap_id"], f["reason_code"], f["language"]) for f in gaps} == {
        ("GAP-EU-SE-CLAIMS_WORDING", "not_encoded", "en"), ("GAP-EU-SE-CLAIMS_WORDING", "not_encoded", "sv")}

    s2 = seed_product(conn)
    job2 = str(one(conn, "select private.enqueue('check', %s, %s, %s) as id", s2["ws"], f"t403:{uuid.uuid4()}",
                   Jsonb({"product_id": s2["product"], "artwork_version_id": s2["av"],
                          "ruleset_version": "T403-PARTIAL", "classification_id": None,
                          "node_ids": ["EU-SE"]}))["id"])
    store = PgCheckStore(conn)
    inputs = store.load(job2, s2["ws"], s2["product"], s2["av"], "T403-PARTIAL", None, ["EU-SE"])
    forged = [CheckResult("EU-SE", inputs.panels[0], "clear", ["TEST.T403.BATCH"], ["TEST.T403.BATCH"])]
    with pytest.raises(psycopg.Error) as exc:
        store.write(job2, inputs, forged)
    assert exc.value.sqlstate == "P0021"
    assert checks_of(conn, job2) == []
    assert one(conn, "select label_state from app.product_nodes where product_id = %s", s2["product"])[
        "label_state"] == "not_assessed"


def test_D04_must_2_claims_are_judged_on_the_printed_language_panel(conn):
    """[D04.must.2] The Swedish panel prints the English designation: the English term elsewhere on the artwork
    never satisfies the Swedish rule, and the finding sits on the Swedish panel."""
    s = seed_product(conn, sv_texts=("Test food for cats", "Testparti: L1"))
    seed_ruleset(conn, "T403-LANG", s["person"])
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    [f] = findings_of(conn, job_id)
    assert (f["rule_key"], f["language"], str(f["panel_id"]), f["state"]) == (
        "TEST.T403.DESIG", "sv", s["panels"]["sv"], "action")


def test_D04_must_3_applied_passed_and_withheld_are_recorded(conn):
    """[D04.must.3] BE-23: an unconfirmed classification leaves the species unknown, so both rules are withheld
    data_missing and recorded as withheld, not applied."""
    s = seed_product(conn, confirmed=False)
    seed_ruleset(conn, "T403-WITHHELD", s["person"])
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    for c in checks_of(conn, job_id):
        assert c["applied_rule_keys"] == [] and c["passed_rule_keys"] == []
        assert sorted(c["withheld_rule_keys"]) == ["TEST.T403.BATCH", "TEST.T403.DESIG"]
        assert c["label_state"] == "not_assessed"
    assert {f["reason_code"] for f in findings_of(conn, job_id)} == {"data_missing"}


def test_D04_must_4_every_finding_carries_provenance_and_a_rule_key_or_gap_id(conn):
    """[D04.must.4] Every finding written has a provenance and a rule_key or gap_id; withheld ones a reason."""
    s = seed_product(conn, sv_texts=("nothing printed",), confirmed=True)
    seed_ruleset(conn, "T403-PROV", s["person"], complete=False)
    job_id = request_check(conn, s)
    assert run_job(conn, job_id) == "succeeded"
    findings = findings_of(conn, job_id)
    assert {f["state"] for f in findings} == {"action", "not_assessed"}
    for f in findings:
        assert f["provenance"] in ("deterministic_rule", "not_assessed")
        assert f["rule_key"] or f["gap_id"]
        assert f["state"] != "not_assessed" or f["reason_code"]


def test_D04_fail_1_no_released_ruleset_is_P0003(conn):
    """[D04.fail.1] With no ruleset released, app.request_check raises P0003; a check job naming a ruleset that was
    never released fails permanently and writes nothing."""
    s = seed_product(conn)
    conn.execute("savepoint no_ruleset")
    # The seed always releases '0000.00-empty' and the table is insert-only, so the test hides every release for
    # this rolled-back savepoint only (triggers, including the insert-only guard, are off in replica mode).
    conn.execute("set local session_replication_role = replica")
    conn.execute("delete from ref.ruleset_versions")
    conn.execute("set local session_replication_role = origin")
    with pytest.raises(psycopg.Error) as exc:
        request_check(conn, s)
    assert exc.value.sqlstate == "P0003"
    conn.execute("rollback to savepoint no_ruleset")

    job_id = str(one(conn, "select private.enqueue('check', %s, %s, %s) as id", s["ws"], f"t403:{uuid.uuid4()}",
                     Jsonb({"product_id": s["product"], "artwork_version_id": s["av"],
                            "ruleset_version": "T403-NEVER", "classification_id": None,
                            "node_ids": ["EU-SE"]}))["id"])
    assert run_job(conn, job_id) == "failed"
    row = one(conn, "select status, last_error from app.jobs where id = %s", job_id)
    assert row["status"] == "failed" and "P0003" in row["last_error"]
    assert NoReleasedRuleset.__name__ in row["last_error"] and checks_of(conn, job_id) == []
