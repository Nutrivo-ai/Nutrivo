"""Incident #360 · `nutrivo fixtures draft`: proposed fixtures built only from a version's own params, applicability and
linked accepted terms, checked by the engine before they are stored, idempotent, and counted by the release gate
only once a person confirmed them. Everything here is synthetic (TEST.I360.* rules, test_i360_* terms)."""
from __future__ import annotations

import json
from pathlib import Path

import psycopg
import pytest
from pgtest import DSN, connect_or_skip
from psycopg.rows import dict_row

from nutrivo_worker import engine  # noqa: F401  registers the evaluators
from nutrivo_worker import fixtures_draft as fd
from nutrivo_worker import fixtures_runner as fr
from nutrivo_worker.engine.core import Node

SE = Node("EU-SE", ("sv",), "EU")
FI = Node("EU-FI", ("fi", "sv"), "EU")
TERMS = {("test_i360_batch", "sv"): ["Testparti"], ("test_i360_desig", "sv"): ["Syntetisk benämning"],
         ("test_i360_net", "sv"): ["Nettovikt"], ("test_i360_warn", "sv"): ["Testvarning"]}


def v(shape: str, params: dict, applicability: dict | None = None, key: str = "TEST.I360.A") -> fd.Version:
    return fd.Version(key, 1, shape, "EU", params, applicability or {"all": []})


class FakeStore:
    def __init__(self, versions: list[fd.Version], nodes: list[Node] | None = None, terms: dict | None = None):
        self._versions, self._nodes, self._terms = versions, nodes or [SE], TERMS if terms is None else terms
        self.rows: list[dict] = []
        self.locks = 0

    def versions(self, rule_key):
        return [x for x in self._versions if rule_key is None or x.rule_key == rule_key]

    def nodes(self, node_id):
        return self._nodes

    def terms(self):
        return self._terms

    def lock(self, v):
        self.locks += 1

    def existing(self, v):
        return [fd.Existing(r["status"], r["expected_outcome"], r["input"], r["expected"]) for r in self.rows
                if (r["rule_key"], r["version"]) == (v.rule_key, v.version)]

    def insert(self, v, p, runner):
        self.rows.append({"rule_key": v.rule_key, "version": v.version, "name": p.name, "input": p.input,
                          "expected_outcome": p.expected_outcome, "expected": p.expected, "status": "proposed",
                          "proposed_by": runner})
        return f"fx-{len(self.rows)}"


def outcomes(results):
    return [(r.outcome, r.status, r.reason) for r in results]


@pytest.mark.parametrize("version", [
    v("mandatory_particular", {"particular": "batch", "detect": {"term_keys": ["test_i360_batch"]}}),
    v("mandatory_particular", {"particular": "batch", "detect": {"term_keys": ["test_i360_batch"]},
                               "scope": "any_panel"}),
    v("prescribed_wording", {"term_key": "test_i360_desig", "match": "exact"}),
    v("threshold", {"quantity": "synthetic", "operator": "gt", "value": 4, "unit": "%", "then": "warn",
                    "detect": {"term_keys": ["test_i360_warn"]}}),
    v("threshold", {"quantity": "synthetic", "operator": "lt", "value": 0, "unit": "%", "then": "warn",
                    "detect": {"term_keys": ["test_i360_warn"]}}),
    v("character_height", {"target": "net", "height_definition": "x_height",
                           "detect": {"term_keys": ["test_i360_net"]},
                           "bands": [{"quantity_from": 0, "quantity_to": 50, "quantity_unit": "g", "min_height_mm": 2},
                                     {"quantity_from": 50, "quantity_to": None, "quantity_unit": "g",
                                      "min_height_mm": 3}]}),
    v("character_height", {"target": "net", "height_definition": "cap_height",
                           "detect": {"term_keys": ["test_i360_net"]}, "bands": [{"min_height_mm": 1.2}]}),
], ids=["mandatory", "mandatory-any-panel", "prescribed", "threshold-gt", "threshold-lt", "height-banded",
        "height-open"])
def test_K05_main_every_drafted_shape_gets_passed_failed_and_withheld_that_the_engine_agrees_with(version):
    store = FakeStore([version])
    results = fd.run(store)
    assert outcomes(results) == [("passed", "stored", None), ("failed", "stored", None), ("withheld", "stored", None)]
    assert all(r.node == "EU-SE" and r.language == "sv" for r in results)
    assert [r["status"] for r in store.rows] == ["proposed"] * 3
    assert all(r["proposed_by"].endswith("fixtures_draft") for r in store.rows)
    withheld = store.rows[2]
    assert withheld["input"]["panel"]["language"] == fd.UNDETERMINED and withheld["expected"] == {"reason": "data_missing"}
    assert store.rows[1]["expected"] == {"findings": [{"rule_key": "TEST.I360.A"}]}
    # Each stored fixture, run as `nutrivo fixtures run` runs it, matches.
    for row in store.rows:
        f = fr.RuleFixture("x", version.rule_key, 1, version.shape, row["name"], row["input"], row["expected_outcome"],
                           row["expected"], version.params, version.applicability, TERMS)
        assert [r.result for r in fr.run_rule_fixtures(fd._One(f), "t")] == ["matched"]


def test_inputs_hold_only_the_linked_terms_and_the_params_own_values():
    version = v("threshold", {"quantity": "synthetic", "operator": "ge", "value": 7.5, "unit": "mg/kg",
                              "then": "warn", "detect": {"term_keys": ["test_i360_warn"]}})
    store = FakeStore([version])
    fd.run(store)
    passed, failed, withheld = (r["input"] for r in store.rows)
    assert passed["panel"]["text_objects"] == [{"text": "Testvarning"}]       # the accepted register entry, verbatim
    assert failed["panel"]["text_objects"] == []                              # nothing printed: no invented text
    assert passed["product"]["quantities"] == {"synthetic": {"value": 7.5, "unit": "mg/kg"}}
    assert passed["node"] == {"id": "EU-SE", "languages": ["sv"], "region": "EU"}
    assert passed["classification"] == {} and withheld["panel"]["text_objects"] == passed["panel"]["text_objects"]


def test_classification_facts_are_only_values_the_applicability_names():
    pred = {"all": [{"eq": ["species", "dog"]}, {"in": ["life_stage", ["adult", "senior"]]},
                    {"not": {"eq": ["format", "treat"]}}]}
    # format is only ever compared by `not eq`: no value the predicate names makes it apply, so a format is left out
    # (unknown) and the rule cannot apply; nothing is invented.
    assert fd.applicable_facts(pred, SE, "sv") is None
    pred = {"all": [{"eq": ["species", "dog"]}, {"in": ["life_stage", ["adult", "senior"]]},
                    {"any": [{"eq": ["format", "dry"]}, {"eq": ["format", "wet"]}]}]}
    assert fd.applicable_facts(pred, SE, "sv") == {"species": "dog", "life_stage": "adult", "format": "dry"}
    assert fd.applicable_facts({"eq": ["node_id", "EU-FI"]}, SE, "sv") is None
    assert fd.applicable_facts({"all": []}, SE, "sv") == {}


def test_a_node_the_rule_does_not_apply_to_is_passed_over_for_one_it_does():
    version = v("mandatory_particular", {"detect": {"term_keys": ["test_i360_batch"]}},
                {"all": [{"eq": ["node_id", "EU-SE"]}, {"eq": ["species", "cat"]}]})
    store = FakeStore([version], nodes=[FI, SE])
    results = fd.run(store)
    assert [r.status for r in results] == ["stored"] * 3 and results[0].node == "EU-SE"
    assert store.rows[0]["input"]["classification"] == {"species": "cat"}


@pytest.mark.parametrize(("version", "terms", "reason"), [
    (v("claim_judgement", {"question": "synthetic"}), TERMS, fd.SHAPE_NOT_DRAFTED),
    (v("additive_condition", {"check": "within_max_content"}), TERMS, fd.SHAPE_NOT_DRAFTED),
    (v("mandatory_particular", {"particular": "no links"}), TERMS, fd.PARAMS_INCOMPLETE),
    (v("mandatory_particular", {"detect": {"term_keys": ["test_i360_batch"]}}), {}, fd.NO_LINKED_TERM),
    (v("mandatory_particular", {"detect": {"term_keys": ["test_i360_batch"]}}, {"has": "species"}), TERMS,
     fd.APPLICABILITY_UNSATISFIED),
    (v("character_height", {"height_definition": "figure_height", "detect": {"term_keys": ["test_i360_net"]},
                            "bands": [{"min_height_mm": 2}]}), TERMS, fd.PARAMS_INCOMPLETE),
    (v("threshold", {"quantity": "synthetic", "unit": "%", "detect": {"term_keys": ["test_i360_warn"]}}), TERMS,
     fd.PARAMS_INCOMPLETE),
    (v("character_height", {"height_definition": "x_height", "detect": {"term_keys": ["test_i360_net"]},
                            "bands": [{"quantity_from": 0, "quantity_to": 50, "quantity_unit": "g",
                                       "min_height_mm": 2, "from_inclusive": "yes"}, {"min_height_mm": 3}]}), TERMS,
     fd.PARAMS_INCOMPLETE),
])
def test_what_cannot_be_built_from_stored_values_is_skipped_with_a_reason(version, terms, reason):
    store = FakeStore([version], terms=terms)
    assert outcomes(fd.run(store)) == [(None, "skipped", reason)]
    assert store.rows == [] and store.locks == 0


def test_a_proposal_the_engine_judges_otherwise_is_never_stored(monkeypatch):
    monkeypatch.setitem(fr.EVALUATORS, "mandatory_particular", lambda f: fr.Evaluation("passed"))
    store = FakeStore([v("mandatory_particular", {"detect": {"term_keys": ["test_i360_batch"]}})])
    results = fd.run(store)
    assert outcomes(results) == [("passed", "stored", None),
                                 ("failed", "skipped", "engine_disagreed:passed"),
                                 ("withheld", "skipped", "engine_disagreed:passed")]
    assert [r["expected_outcome"] for r in store.rows] == ["passed"]


def test_idempotent_and_a_rejected_fixture_is_not_proposed_again():
    version = v("prescribed_wording", {"term_key": "test_i360_desig"})
    store = FakeStore([version])
    fd.run(store)
    store.rows[0]["status"] = "confirmed"
    store.rows[1]["status"] = "rejected"
    again = fd.run(store)
    assert outcomes(again) == [("passed", "unchanged", "confirmed"), ("failed", "skipped", fd.REJECTED),
                               ("withheld", "unchanged", "proposed")]
    assert len(store.rows) == 3


def test_dry_run_writes_nothing_and_takes_no_lock():
    store = FakeStore([v("prescribed_wording", {"term_key": "test_i360_desig"})])
    assert [r.status for r in fd.run(store, dry_run=True)] == ["drafted"] * 3
    assert store.rows == [] and store.locks == 0


def test_a_failing_version_is_reported_and_the_run_goes_on(monkeypatch):
    good = v("prescribed_wording", {"term_key": "test_i360_desig"}, key="TEST.I360.B")
    store = FakeStore([v("prescribed_wording", {"term_key": "test_i360_desig"}), good])
    calls = {"n": 0}
    original = store.existing

    def boom(version):
        calls["n"] += 1
        if version.rule_key == "TEST.I360.A":
            raise RuntimeError("synthetic")
        return original(version)

    store.existing = boom
    captured = []
    monkeypatch.setattr(fd.sentry_sdk, "capture_exception", captured.append)
    results = fd.run(store)
    assert outcomes(results)[0] == (None, "failed", "RuntimeError") and len(captured) == 1
    assert [r.status for r in results[1:]] == ["stored"] * 3
    assert fd.summary(results) == {"failed": 1, "stored": 3}


def test_rule_filter_and_cli_parser():
    store = FakeStore([v("prescribed_wording", {"term_key": "test_i360_desig"}),
                       v("prescribed_wording", {"term_key": "test_i360_desig"}, key="TEST.I360.B")])
    assert {r.rule_key for r in fd.run(store, "TEST.I360.B")} == {"TEST.I360.B"}
    from nutrivo_worker import cli
    with pytest.raises(SystemExit) as done:
        cli.main(["fixtures", "draft", "--help"])
    assert done.value.code == 0


# ─── Postgres: draft → confirm in /admin's RPC → run → release ───────────────────────────────────────────────────────
STAFF_USER = "00000000-0000-4000-8360-00000000c0de"
DRAFT = "2026.94-i360"


@pytest.fixture
def pg():
    conn = connect_or_skip(lambda dsn: psycopg.connect(dsn, autocommit=True, row_factory=dict_row), DSN)
    try:
        yield conn
    finally:
        conn.close()


def _synthetic_rule(conn) -> None:
    conn.execute("insert into auth.users (id, email) values (%s, 'staff@i360.test')", (STAFF_USER,))
    person = conn.execute("insert into app.people (user_id, display_name, email) values (%s, 'i360', "
                          "'staff@i360.test') returning id", (STAFF_USER,)).fetchone()["id"]
    conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values ('TEST.I360.PG', "
                 "'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic test rule')")
    conn.execute("""insert into ref.rule_versions (rule_key, version, status, params, article_ref, source_excerpt,
                    effect_type, accepted_by, accepted_at) values ('TEST.I360.PG', 1, 'accepted',
                    '{"particular": "Test batch", "detect": {"term_keys": ["test_i360_pg_batch"]}}',
                    'synthetic', 'synthetic', 'new_obligation', %s, now())""", (person,))
    conn.execute("""insert into ref.term_entries (term_key, language, term, kind, article_ref, status)
                    values ('test_i360_pg_batch', 'sv', 'Testparti', 'heading', 'synthetic', 'accepted')""")


def _as_staff(conn) -> None:
    conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(
        {"sub": STAFF_USER, "role": "authenticated", "aal": "aal2", "app_metadata": {"nutrivo_staff": True}}),))


def test_pg_K05_main_drafted_fixtures_count_for_the_release_only_once_a_person_confirmed_them(pg):
    with pg.transaction():
        _synthetic_rule(pg)
        store = fd.PgDraftStore(pg)
        results = fd.run(store, "TEST.I360.PG")
        assert outcomes(results) == [("passed", "stored", None), ("failed", "stored", None),
                                     ("withheld", "stored", None)]
        rows = pg.execute("""select id, status, proposed_by, proposed_at, decided_by from ref.rule_fixtures
                             where rule_key = 'TEST.I360.PG' order by name""").fetchall()
        assert [r["status"] for r in rows] == ["proposed"] * 3
        assert all(r["proposed_by"].endswith("fixtures_draft") and r["proposed_at"] and r["decided_by"] is None
                   for r in rows)
        assert outcomes(fd.run(store, "TEST.I360.PG")) == [("passed", "unchanged", "proposed"),
                                                           ("failed", "unchanged", "proposed"),
                                                           ("withheld", "unchanged", "proposed")]
        assert pg.execute("select count(*) as n from ref.rule_fixtures where rule_key = 'TEST.I360.PG'"
                          ).fetchone()["n"] == 3
        assert pg.execute("select private.version_tested('TEST.I360.PG', 1) as t").fetchone()["t"] is False

        _as_staff(pg)
        pg.execute("set local role authenticated")
        pg.execute("select app.create_ruleset_draft(%s, 'synthetic')", (DRAFT,))
        pg.execute("select app.set_draft_member(%s, 'TEST.I360.PG', 1)", (DRAFT,))
        pg.execute("reset role")
        # Proposed only: the runner reads none of them, so nothing can pass.
        draft_store = fr.DraftFixtureStore(pg)
        report = fr.run(draft_store, DRAFT, Path("/nonexistent"))
        assert [(r.item, r.reason) for r in report.results if r.rule_key == "TEST.I360.PG"] == [
            ("TEST.I360.PG", fr.NO_FIXTURES)]

        pg.execute("set local role authenticated")
        for r in rows:
            pg.execute("select app.decide_rule_fixture(%s, 'confirm')", (r["id"],))
        pg.execute("reset role")
        assert pg.execute("select private.version_tested('TEST.I360.PG', 1) as t").fetchone()["t"] is True
        assert fd.run(store, "TEST.I360.PG") == []           # a fully confirmed version is not drafted again

        digest = draft_store.digest(DRAFT)
        report = fr.run(draft_store, DRAFT, Path("/nonexistent"))
        mine = [r for r in report.results if r.rule_key == "TEST.I360.PG"]
        assert [r.result for r in mine] == ["matched"] * 3
        assert report.passed and report.rule_fixtures_ran == 3
        fr.record_run(pg, DRAFT, digest, report)
        pg.execute("set local role authenticated")
        assert pg.execute("select app.release_ruleset(%s) as r", (DRAFT,)).fetchone()["r"]["ruleset_version"] == DRAFT
        raise psycopg.Rollback()


def test_pg_a_rejected_fixture_is_not_proposed_again(pg):
    with pg.transaction():
        _synthetic_rule(pg)
        store = fd.PgDraftStore(pg)
        fd.run(store, "TEST.I360.PG")
        failed = pg.execute("select id from ref.rule_fixtures where rule_key = 'TEST.I360.PG' "
                            "and expected_outcome = 'failed'").fetchone()["id"]
        _as_staff(pg)
        pg.execute("set local role authenticated")
        pg.execute("select app.decide_rule_fixture(%s, 'reject', 'synthetic')", (failed,))
        pg.execute("reset role")
        assert outcomes(fd.run(store, "TEST.I360.PG"))[1] == ("failed", "skipped", fd.REJECTED)
        raise psycopg.Rollback()

