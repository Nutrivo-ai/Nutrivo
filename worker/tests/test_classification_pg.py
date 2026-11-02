"""T-402 (D03) on real Postgres: the suggestion written after extraction, its model_calls row and citation, and how a
check treats it. Everything is rolled back (the fixture of test_check_pg). The model is a scripted fake; rules,
terms and the ruleset are synthetic (TEST.T403.*), never law.

A person's confirmation goes through app.confirm_classification as the editor, exactly as the web sends it."""
import json

import pytest
from fakes import FakeProvider
from test_check_pg import checks_of, findings_of, one, pg_conn, request_check, run_job, seed_product, seed_ruleset

from nutrivo_worker import models
from nutrivo_worker.classification import ClassificationSuggestion, suggest_for_run
from nutrivo_worker.config import Settings
from nutrivo_worker.models import Models

RULES = ["TEST.T403.BATCH", "TEST.T403.DESIG"]


def field(value=None, *, quote=None, panel_index=None, confidence=0.95):
    return {"value": value, "abstain": value is None, "confidence": confidence if value else 0, "quote": quote,
            "panel_index": panel_index}


def sure_answer():
    return ClassificationSuggestion.model_validate({
        "species": field("cat", quote="Test food for cats", panel_index=1),
        "life_stage": field(),
        "product_class": field("complete", quote="Test food for cats", panel_index=1, confidence=0.5),
        "intended_use": field(), "parnut_status": field()}).model_dump_json()


@pytest.fixture
def conn():
    yield from pg_conn()


@pytest.fixture
def fake_model(monkeypatch, tmp_path):
    provider = FakeProvider(text=sure_answer())
    monkeypatch.setattr(models, "_default", Models(Settings(models_mode="live", cassette_dir=tmp_path), [provider]))
    return provider


def confirm(conn, s, species="cat"):
    """The person's confirmation, through app.confirm_classification as the editor (RLS and the RPC's own checks), on
    the product's latest classification. Returns the new row's id."""
    basis = one(conn, "select id from app.classifications where product_id = %s order by created_at desc, id desc"
                      " limit 1", s["product"])
    with conn.transaction():          # a savepoint: on an error it also undoes the role and the claims
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{s["user"]}","role":"authenticated"}}',))
        conn.execute("set local role authenticated")
        cid = str(one(conn, "select app.confirm_classification(%s, %s, %s, null, 'complete', null, null) as id",
                      s["product"], basis["id"] if basis else None, species)["id"])
        conn.execute("reset role")
    return cid


def suggest(conn, s):
    return suggest_for_run(conn, s["ws"], s["product"], s["av"], s["run"])


def test_D03_main_classify_the_product_suggestion_stored_with_citation_then_confirmed(conn, fake_model):
    """[D03.main] The worker suggests from the label text with a citation, it is stored insert-only with its
    provenance and model call, and a person's confirmation is what the check then uses."""
    s = seed_product(conn, classified=False)
    seed_ruleset(conn, "T402-MAIN", s["person"])
    out = suggest(conn, s)
    assert out["outcome"] == "suggested" and out["filled"] == 1
    row = one(conn, "select * from app.classifications where id = %s", out["classification_id"])
    assert row["provenance"] == "model_judgement" and row["confirmed_at"] is None and row["confirmed_by"] is None
    assert row["species"] == "cat"
    assert row["product_class"] is None                      # 0.5 is unsure: left for the person (D03.fail.1)
    cite = json.loads(row["citation"])
    assert cite["basis"] == "label_text" and cite["extraction_run_id"] == s["run"]
    assert cite["fields"]["species"]["quote"] == "Test food for cats"
    assert cite["fields"]["species"]["language"] == "en"
    assert cite["empty"]["product_class"] == "low_confidence"
    call = one(conn, "select * from app.model_calls where id = %s", row["model_call_id"])
    assert call["purpose"] == "classification" and call["prompt_version"] == "classification.v1"
    assert str(call["workspace_id"]) == s["ws"]
    # the printed panel text went to the model as data, in its own language
    assert "Testfoder för katter" in fake_model.calls[0]["user"]

    assert suggest(conn, s) == {"outcome": "already_suggested", "classification_id": out["classification_id"]}
    assert len(fake_model.calls) == 1                        # a retry calls no model and writes nothing

    cid = confirm(conn, s)                                   # species as suggested; product class set by the person
    person = one(conn, "select * from app.classifications where id = %s", cid)
    assert person["provenance"] == "person" and str(person["confirmed_by"]) == s["person"]
    assert person["confirmed_at"] is not None and person["species"] == "cat" and person["product_class"] == "complete"
    pcite = json.loads(person["citation"])
    assert pcite["basis_classification_id"] == out["classification_id"] and pcite["edited"] == ["product_class"]
    assert pcite["fields"]["species"]["quote"] == "Test food for cats"   # the label evidence of the confirmed value
    assert one(conn, "select count(*)::int as n from app.audit_events where kind = 'classification.confirmed'"
                     " and object_id = %s", cid)["n"] == 1
    job = request_check(conn, s)
    assert run_job(conn, job) == "succeeded"
    checks = checks_of(conn, job)
    assert checks and all(str(c["classification_id"]) == cid for c in checks)
    assert {k for c in checks for k in c["applied_rule_keys"]}            # the confirmed species applies rules
    assert "data_missing" not in {f["reason_code"] for f in findings_of(conn, job)}


def test_D03_must_1_classification_comes_before_any_rule(conn, fake_model):
    """[D03.must.1] BE-19: an unconfirmed suggestion is no classification, so every rule whose applicability reads it
    is withheld data_missing; only after a person confirms is any rule applied."""
    s = seed_product(conn, classified=False)
    seed_ruleset(conn, "T402-BEFORE", s["person"])
    assert suggest(conn, s)["outcome"] == "suggested"
    job = request_check(conn, s)
    assert run_job(conn, job) == "succeeded"
    for c in checks_of(conn, job):
        assert c["applied_rule_keys"] == [] and sorted(c["withheld_rule_keys"]) == RULES
        assert c["label_state"] == "not_assessed"
    assert {f["reason_code"] for f in findings_of(conn, job)} == {"data_missing"}

    confirm(conn, s)
    job2 = request_check(conn, s)
    assert run_job(conn, job2) == "succeeded"
    applied = {k for c in checks_of(conn, job2) for k in c["applied_rule_keys"]}
    assert applied and applied <= set(RULES)


def test_D03_must_2_a_new_classification_makes_the_previous_check_stale(conn):
    """[D03.must.2] The check job key carries the classification: the same inputs map to the same job, and a new
    classification row maps to a new job, so the previous check no longer answers for the product."""
    s = seed_product(conn)
    seed_ruleset(conn, "T402-STALE", s["person"])
    first = request_check(conn, s)
    assert request_check(conn, s) == first                   # unchanged inputs: the same job
    cid = confirm(conn, s)
    second = request_check(conn, s)
    assert second != first
    k1, k2 = (one(conn, "select idempotency_key, payload from app.jobs where id = %s", j) for j in (first, second))
    assert k1["idempotency_key"] != k2["idempotency_key"] and cid in k2["idempotency_key"]
    assert k2["payload"]["classification_id"] == cid


def test_D03_main_no_suggestion_over_a_persons_confirmed_classification(conn, fake_model):
    s = seed_product(conn)                                   # the latest row is confirmed by a person
    out = suggest(conn, s)
    assert out["outcome"] == "skipped_confirmed" and fake_model.calls == []


def test_D03_fail_1_a_model_error_writes_no_row_and_never_fails(conn, monkeypatch, tmp_path):
    s = seed_product(conn, classified=False)
    monkeypatch.setattr(models, "_default", Models(Settings(models_mode="live", cassette_dir=tmp_path),
                                                   [FakeProvider(fail=99)]))
    assert suggest(conn, s) == {"outcome": "withheld", "reason": "model_unavailable"}
    assert one(conn, "select count(*)::int as n from app.classifications where product_id = %s",
               s["product"])["n"] == 0


def test_D03_main_a_confirmation_made_during_the_model_call_wins(conn, monkeypatch, tmp_path):
    """The suggestion's final check runs under the product lock: a person who confirmed while the model was answering
    is never overwritten by an unconfirmed suggestion."""
    s = seed_product(conn, classified=False)

    class ConfirmingProvider(FakeProvider):
        def complete(self, *a, **k):
            confirm(conn, s)                                 # a person confirms while the model answers
            return super().complete(*a, **k)

    monkeypatch.setattr(models, "_default", Models(Settings(models_mode="live", cassette_dir=tmp_path),
                                                   [ConfirmingProvider(text=sure_answer())]))
    out = suggest(conn, s)
    assert out["outcome"] == "skipped_confirmed"
    latest = one(conn, "select provenance, confirmed_at from app.classifications where product_id = %s"
                       " order by created_at desc, id desc limit 1", s["product"])
    assert latest["provenance"] == "person" and latest["confirmed_at"] is not None
