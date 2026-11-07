"""T-503 on real Postgres: a claim_judgement rule in a released ruleset, run through the check handler with a
scripted fake model (no real model call). Rolled back at the end; rules and claims are synthetic (TEST.T503.*)."""
import uuid

import pytest
from psycopg.types.json import Jsonb
from test_check_pg import DOMAINS, checks_of, findings_of, one, pg_conn, request_check, seed_product
from test_engine_t503 import PARAMS, ScriptedModel, answer, models_for

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore
from nutrivo_worker.engine.claims import StaticThresholdRecords
from nutrivo_worker.engine.store import PgCheckStore
from nutrivo_worker.handlers import check as check_handler
from nutrivo_worker.jobs import Job, JobContext

S = Settings(max_attempts=5, stale_after_s=900)
KEY = "TEST.T503.CLAIM"


@pytest.fixture
def conn():
    yield from pg_conn()


def seed_claim_ruleset(conn, rv, person):
    conn.execute("insert into ref.ruleset_versions (id, notes) values (%s, 'T-503 synthetic test ruleset')", (rv,))
    conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values (%s, 'claim_judgement',"
                 " 'claims_wording', 'EU-SE', 'Synthetic claim rule') on conflict do nothing", (KEY,))
    conn.execute("insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref,"
                 " source_excerpt, accepted_by, accepted_at) values (%s, 1, 'accepted', %s, '{\"all\": []}',"
                 " 'TEST Art. 3', 'synthetic', %s, now()) on conflict do nothing", (KEY, Jsonb(PARAMS), person))
    conn.execute("insert into ref.ruleset_members (ruleset_version, rule_key, version) values (%s, %s, 1)", (rv, KEY))
    for d in DOMAINS:
        conn.execute("insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded)"
                     " values (%s, 'EU-SE', %s, 'complete', 1)", (rv, d))


HEARTBEATS: list[dict] = []


class RecordingContext(JobContext):
    def heartbeat(self, **progress):
        HEARTBEATS.append(progress)
        super().heartbeat(**progress)


def run(conn, s, job_id, model, thresholds, tmp_path):
    jrow = one(conn, "select payload, workspace_id from app.jobs where id = %s", job_id)
    job = Job(job_id, "check", str(jrow["workspace_id"]), jrow["payload"], 1)
    return check_handler.run_check(job, RecordingContext(job, PgStore(conn), S), PgCheckStore(conn),
                                   models_for(tmp_path, model), thresholds)


def test_a_judged_claim_is_written_as_a_model_finding_with_its_model_call(conn, tmp_path):
    s = seed_product(conn, sv_texts=("Grön testkula",))
    seed_claim_ruleset(conn, f"T503-{uuid.uuid4().hex[:6]}", s["person"])
    job_id = request_check(conn, s)
    run(conn, s, job_id, ScriptedModel({"Grön testkula": answer("prohibited", 0.9)}),
        StaticThresholdRecords(frozenset({(KEY, 1, "sv")})), tmp_path)
    sv = next(c for c in checks_of(conn, job_id) if c["language"] == "sv")
    assert sv["label_state"] == "action" and sv["applied_rule_keys"] == [KEY]
    [f] = [f for f in findings_of(conn, job_id) if f["language"] == "sv"]
    assert (f["rule_key"], f["state"], f["provenance"], float(f["confidence"])) == (KEY, "action",
                                                                                   "model_judgement", 0.9)
    call = one(conn, "select purpose, prompt_version, workspace_id from app.model_calls where id = %s",
               f["model_call_id"])
    assert (call["purpose"], call["prompt_version"], str(call["workspace_id"])) == (
        "claim_judgement", "claim_judgement.v1", s["ws"])
    # The job heartbeats after each panel while judging, so the reaper never requeues it mid-check.
    assert HEARTBEATS[-3:] == [{"checks": 1}, {"checks": 2}, {"outcome": "checked", "checks": 2, "clear": 0,
                                                              "action": 1, "not_assessed": 1}]


def test_without_a_threshold_record_the_claim_rule_is_withheld_and_no_model_is_called(conn, tmp_path):
    s = seed_product(conn, sv_texts=("Grön testkula",))
    seed_claim_ruleset(conn, f"T503-{uuid.uuid4().hex[:6]}", s["person"])
    job_id = request_check(conn, s)
    model = ScriptedModel({"Grön testkula": answer("prohibited", 0.9)})
    run(conn, s, job_id, model, None, tmp_path)
    sv = next(c for c in checks_of(conn, job_id) if c["language"] == "sv")
    assert sv["label_state"] == "not_assessed" and sv["withheld_rule_keys"] == [KEY]
    [f] = [f for f in findings_of(conn, job_id) if f["language"] == "sv"]
    assert (f["reason_code"], f["provenance"]) == ("claim_not_evaluated", "not_assessed")
    assert model.calls == []
