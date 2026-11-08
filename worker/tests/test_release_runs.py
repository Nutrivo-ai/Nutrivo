"""T-210 (D-32, D-31): release runs. `nutrivo fixtures run --draft <id>` judges a draft's member fixtures with the
engine and records the run in ref.fixture_runs for the release gate; synthetic labels are never part of a run and
golden labels join from GOLDEN_GATE of them; prescribed_wording accepts other wordings only through register keys.

Rules, terms and wording here are synthetic test data (TEST.T210.*), never regulatory content."""
import json
from pathlib import Path

import psycopg
import pytest
from pgtest import connect_or_skip

from nutrivo_worker import cli, db
from nutrivo_worker import fixtures_runner as fr
from nutrivo_worker.engine import core  # importing the engine registers the evaluators
from nutrivo_worker.engine.core import Coverage, Node, Panel, Rule, TextLine, evaluate_check

DRAFT = "2026.91-t210"


# ─── Labels in a run (D-32) ──────────────────────────────────────────────────────────────────────────────────────

class FakeStore:
    def __init__(self, members=(), fixtures=()):
        self._members, self._fixtures = list(members), list(fixtures)

    def members(self, _):
        return self._members

    def fixtures(self, _):
        return self._fixtures


def golden_labels(d: Path, n: int) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    (d / "README.md").write_text("people only")
    (d / ".keep").write_text("")
    for i in range(n):
        (d / f"label-{i:02d}.expected.json").write_text(json.dumps({"panels": [{"index": 0, "language": "sv"}]}))
    return d


def test_synthetic_labels_are_never_part_of_a_run(tmp_path):
    report = fr.run(FakeStore(), DRAFT, tmp_path / "golden", evaluators={})
    assert not [r for r in report.results if r.kind == "synthetic"]
    assert report.labels["synthetic"] == "not part of a release run (D-32)"


def test_golden_labels_below_the_gate_are_counted_and_left_out(tmp_path):
    golden = golden_labels(tmp_path / "golden", fr.GOLDEN_GATE - 1)
    assert fr.golden_label_count(golden) == 29                # README and hidden files are not labels
    report = fr.run(FakeStore(), DRAFT, golden, evaluators={})
    assert not [r for r in report.results if r.kind == "golden"]
    assert report.labels["golden"] == {"count": 29, "threshold": 30, "included": False}
    assert "golden labels: 29 of 30, not yet part of the run (D-32)" in fr.format_text(report)


def test_from_the_gate_every_golden_panel_is_judged_and_an_unjudged_one_fails_the_run(tmp_path):
    golden = golden_labels(tmp_path / "golden", fr.GOLDEN_GATE)
    member = fr.Member("TEST.T210.A", 1, "mandatory_particular")
    fx = fr.RuleFixture("f", "TEST.T210.A", 1, "mandatory_particular", "f", {}, "passed")
    report = fr.run(FakeStore([member], [fx]), DRAFT, golden,
                    evaluators={"mandatory_particular": lambda f: fr.Evaluation("passed")})
    golden_results = [r for r in report.results if r.kind == "golden"]
    assert len(golden_results) == 30 and {r.reason for r in golden_results} == {fr.ENGINE_UNAVAILABLE}
    assert report.labels["golden"]["included"] is True
    assert report.rule_fixtures_ran == 1 and not report.passed       # no label evaluator yet: withheld, never passed


# ─── prescribed_wording alternatives only through register keys (D-31) ───────────────────────────────────────────

TERMS = {("test_t210_designation", "sv"): ("Testfoder för katter",),
         ("test_t210_alt", "sv"): ("Testkost för katter",), ("test_t210_alt", "en"): ("Test meal for cats",)}
SE = Node("EU-SE", ("sv",), "EU")
COMPLETE = [Coverage(d, "complete", None, None) for d in core.COVERAGE_DOMAINS]
FACTS = {"species": "cat", "life_stage": "adult", "product_class": "complete", "intended_use": None,
         "parnut_status": None, "format": "dry"}


def wording_rule(params):
    return Rule("TEST.T210.DESIG", 1, "prescribed_wording", "mandatory_particulars", "EU", "Synthetic test rule",
                params, {"all": []}, "TEST Art. 1")


def sv_panel(text):
    return Panel(0, "sv", "extracted", None, (TextLine(text, "t0", [0, 0, 1, 1]),), "p-sv")


def check(text, params):
    p = sv_panel(text)
    return evaluate_check(SE, p, (p,), [wording_rule(params)], COMPLETE, TERMS, FACTS)


def test_an_alternative_passes_only_through_its_register_entry_in_the_panels_language():
    params = {"term_key": "test_t210_designation", "alternative_term_keys": ["test_t210_alt"]}
    assert check("Testkost för katter", params).label_state == "clear"
    # The alternative's English entry is in the register, but a Swedish panel is judged on Swedish only.
    assert check("Test meal for cats", params).label_state == "action"


def test_the_extractions_own_alternatives_are_never_matched():
    for alternatives in (["Testkost för katter"], {"sv": ["Testkost för katter"]}):
        res = check("Testkost för katter", {"term_key": "test_t210_designation", "alternatives": alternatives})
        assert res.label_state == "action"


def test_malformed_alternative_term_keys_are_withheld_never_passed():
    res = check("Testfoder för katter", {"term_key": "test_t210_designation", "alternative_term_keys": "test_t210_alt"})
    assert res.withheld == ["TEST.T210.DESIG"] and res.findings[0]["reason_code"] == "evaluator_error"


# ─── The CLI: --draft records, --ruleset never does ──────────────────────────────────────────────────────────────

class FakeConn:
    def __init__(self):
        self.sql = []

    def execute(self, sql, *a, **k):
        self.sql.append(sql)
        return self

    def transaction(self):
        import contextlib
        return contextlib.nullcontext()

    def close(self):
        pass


class FakeDraftStore(FakeStore):
    def __init__(self, *a, known=True, **k):
        super().__init__(*a, **k)
        self.known = known

    def digest(self, draft_id):
        if not self.known:
            raise fr.UnknownDraft(f"no ruleset draft {draft_id}")
        return "d1"


@pytest.fixture
def cli_env(monkeypatch, tmp_path):
    for name in ("SENTRY_DSN_WORKER", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://fixtures-test.invalid/db")
    conn = FakeConn()
    monkeypatch.setattr(db, "connect", lambda dsn: conn)
    recorded = []
    monkeypatch.setattr(fr, "record_run", lambda c, draft, digest, report: recorded.append((draft, digest,
                                                                                            report.passed)) or "r1")
    return conn, recorded, tmp_path / "golden"


def test_cli_draft_run_is_recorded_with_the_digest_read_in_the_same_snapshot(cli_env, monkeypatch, capsys):
    conn, recorded, golden = cli_env
    member = fr.Member("TEST.T210.A", 1, "mandatory_particular")
    monkeypatch.setattr(fr, "DraftFixtureStore", lambda c: FakeDraftStore([member], []))
    assert cli.main(["fixtures", "run", "--draft", DRAFT, "--format", "json", "--golden", str(golden)]) == 1
    assert recorded == [(DRAFT, "d1", False)]         # a run that did not pass is recorded too: the latest one counts
    assert json.loads(capsys.readouterr().out)["ruleset_version"] == DRAFT
    assert "repeatable read, read only" in conn.sql[0]


def test_cli_unknown_or_released_draft_exits_2_and_records_nothing(cli_env, monkeypatch, capsys):
    _, recorded, golden = cli_env
    monkeypatch.setattr(fr, "DraftFixtureStore", lambda c: FakeDraftStore(known=False))
    assert cli.main(["fixtures", "run", "--draft", "2026.99-nope", "--golden", str(golden)]) == 2
    assert recorded == [] and "no ruleset draft 2026.99-nope" in capsys.readouterr().err


def test_cli_ruleset_run_records_nothing(cli_env, monkeypatch):
    _, recorded, golden = cli_env
    monkeypatch.setattr(fr, "PgFixtureStore", lambda c: FakeStore())
    assert cli.main(["fixtures", "run", "--ruleset", "2026.11-test", "--golden", str(golden)]) == 1
    assert recorded == []


def test_cli_takes_exactly_one_of_ruleset_and_draft(cli_env):
    with pytest.raises(SystemExit):
        cli.main(["fixtures", "run", "--ruleset", "a", "--draft", "b"])
    with pytest.raises(SystemExit):
        cli.main(["fixtures", "run"])


# ─── Postgres: a recorded draft run opens the release gate, and a later change closes it ────────────────────────

STAFF_USER = "00000000-0000-4000-8210-0000000000a1"


@pytest.fixture
def pg():
    conn = connect_or_skip(db.connect)
    yield conn
    conn.close()


def _as_staff(conn):
    conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(
        {"sub": STAFF_USER, "role": "authenticated", "aal": "aal2", "app_metadata": {"nutrivo_staff": True}}),))


def _synthetic_draft(conn):
    """A synthetic rule with passed, failed and withheld fixtures, an accepted synthetic term, and a draft holding it."""
    conn.execute("insert into auth.users (id, email) values (%s, 'staff@t210.test')", (STAFF_USER,))
    person = conn.execute("insert into app.people (user_id, display_name, email) values (%s, 't210', "
                          "'staff@t210.test') returning id", (STAFF_USER,)).fetchone()["id"]
    conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values ('TEST.T210.A', "
                 "'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic test rule')")
    conn.execute("""insert into ref.rule_versions (rule_key, version, status, params, article_ref, source_excerpt,
                    effect_type, accepted_by, accepted_at) values ('TEST.T210.A', 1, 'accepted',
                    '{"particular": "Test batch", "detect": {"term_keys": ["test_t210_batch"]}}',
                    'synthetic', 'synthetic', 'new_obligation', %s, now())""", (person,))
    conn.execute("""insert into ref.term_entries (term_key, language, term, kind, article_ref, status)
                    values ('test_t210_batch', 'sv', 'Testparti', 'heading', 'synthetic', 'accepted')""")
    node = {"id": "EU-SE", "languages": ["sv"], "region": "EU"}
    for name, text, lang, outcome, expected in (
            ("printed", "Testparti: 42", "sv", "passed", None),
            ("absent", "Sammansättning", "sv", "failed", {"findings": [{"rule_key": "TEST.T210.A"}]}),
            ("no language", "Testparti: 42", "und", "withheld", {"reason": "data_missing"})):
        conn.execute("""insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome, expected)
                        values ('TEST.T210.A', 1, %s, %s::jsonb, %s, %s::jsonb)""",
                     (name, json.dumps({"panel": {"language": lang, "text_objects": [{"text": text}]}, "node": node}),
                      outcome, json.dumps(expected) if expected else None))
    _as_staff(conn)
    conn.execute("select app.create_ruleset_draft(%s, 'T-210 synthetic draft')", (DRAFT,))
    conn.execute("select app.set_draft_member(%s, 'TEST.T210.A', 1)", (DRAFT,))


def _run_and_record(conn) -> fr.Report:
    store = fr.DraftFixtureStore(conn)
    digest = store.digest(DRAFT)
    report = fr.run(store, DRAFT, Path("/nonexistent"))
    fr.record_run(conn, DRAFT, digest, report)
    return report


def test_pg_a_recorded_draft_run_opens_the_release_gate(pg):
    with pg.transaction():
        _synthetic_draft(pg)
        report = _run_and_record(pg)
        assert [(r.item, r.result) for r in report.results] == [
            ("absent", "matched"), ("no language", "matched"), ("printed", "matched")]
        assert report.passed and report.rule_fixtures_ran == 3
        run = pg.execute("select * from ref.fixture_runs where draft_id = %s", (DRAFT,)).fetchone()
        assert run["passed"] and run["rule_fixtures_ran"] == 3 and run["runner"].endswith("fixtures_runner")
        assert run["digest"] == pg.execute("select private.ruleset_draft_digest(%s) as d", (DRAFT,)).fetchone()["d"]
        assert run["summary"]["labels"]["golden"]["included"] is False
        released = pg.execute("select app.release_ruleset(%s) as r", (DRAFT,)).fetchone()["r"]
        assert released is not None
        assert pg.execute("select 1 from ref.ruleset_versions where id = %s", (DRAFT,)).fetchone()
        # Released, the draft is frozen: the runner refuses it and points at --ruleset.
        with pytest.raises(fr.UnknownDraft, match="already released"):
            fr.DraftFixtureStore(pg).digest(DRAFT)
        raise psycopg.Rollback()


def test_pg_a_fixture_changed_after_the_run_closes_the_gate(pg):
    with pg.transaction():
        _synthetic_draft(pg)
        _run_and_record(pg)
        pg.execute("update ref.rule_fixtures set input = input || '{\"note\": \"changed\"}' "
                   "where rule_key = 'TEST.T210.A' and name = 'absent'")
        with pytest.raises(psycopg.Error) as err, pg.transaction():
            pg.execute("select app.release_ruleset(%s)", (DRAFT,))
        assert err.value.sqlstate == "P0039" and "changed after the latest fixture run" in str(err.value)
        raise psycopg.Rollback()


def test_pg_an_unknown_draft_is_refused(pg):
    with pytest.raises(fr.UnknownDraft, match="no ruleset draft"):
        fr.DraftFixtureStore(pg).digest("2026.99-t210-none")
