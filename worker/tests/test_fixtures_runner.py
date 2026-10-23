"""T-206: `nutrivo fixtures run --ruleset <id>`. No rule, no verdict: until the engine (T-403) registers evaluators,
every item is withheld with a reason and the run does not pass."""
import json
import os
from pathlib import Path
from xml.etree import ElementTree as ET

import psycopg
import pytest

from nutrivo_worker import cli, db
from nutrivo_worker import fixtures_runner as fr

RULESET = "2026.11-test"


class FakeStore:
    def __init__(self, members=(), fixtures=(), known=True):
        self._members, self._fixtures, self.known = list(members), list(fixtures), known

    def members(self, ruleset_version):
        if not self.known:
            raise fr.UnknownRuleset(f"no released ruleset {ruleset_version}")
        return self._members

    def fixtures(self, ruleset_version):
        return self._fixtures


def fixture(name, outcome="failed", shape="mandatory_particular", rule_key="TEST.RULE.A", expected=None, lang="sv"):
    return fr.RuleFixture(id=name, rule_key=rule_key, version=1, shape=shape, name=name,
                          input={"panel": {"language": lang, "text_objects": []}}, expected_outcome=outcome,
                          expected=expected)


MEMBER = fr.Member("TEST.RULE.A", 1, "mandatory_particular")


def write_synth(d: Path) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    (d / "missing_batch.truth.json").write_text(json.dumps({
        "fixture": "missing_batch", "panels": [
            {"index": 0, "language": "en", "missing": [], "expected_status": "extracted", "expected_failure": None},
            {"index": 1, "language": "sv", "missing": ["batch"], "expected_status": "extracted",
             "expected_failure": None}]}))
    return d


@pytest.fixture
def dirs(tmp_path):
    return write_synth(tmp_path / "synth"), tmp_path / "golden-empty"


def test_without_evaluators_every_rule_fixture_is_withheld_and_the_run_does_not_pass(dirs):
    synth, golden = dirs
    store = FakeStore([MEMBER], [fixture("passes", "passed"), fixture("withholds", "withheld")])
    report = fr.run(store, RULESET, synth, golden, evaluators={})
    rule = [r for r in report.results if r.kind == "rule_fixture"]
    assert [r.result for r in rule] == ["withheld", "withheld"]
    assert {r.reason for r in rule} == {fr.EVALUATOR_MISSING}
    # A fixture expecting `withheld` is still not a match when nothing evaluated it.
    assert not report.passed
    assert report.rule_fixtures_ran == 0


def test_labels_are_withheld_per_language_panel_until_the_engine_exists(dirs):
    synth, golden = dirs
    report = fr.run(FakeStore([MEMBER], [fixture("a")]), RULESET, synth, golden, evaluators={})
    labels = [r for r in report.results if r.kind == "synthetic"]
    assert [(r.item, r.panel, r.language, r.result, r.reason) for r in labels] == [
        ("missing_batch", 0, "en", "withheld", fr.ENGINE_UNAVAILABLE),
        ("missing_batch", 1, "sv", "withheld", fr.ENGINE_UNAVAILABLE)]
    assert labels[1].expected == {"expected_status": "extracted", "expected_failure": None, "missing": ["batch"]}


def test_matched_and_differed_when_an_evaluator_runs(dirs):
    synth, golden = dirs
    store = FakeStore([MEMBER], [fixture("fails", "failed", expected={"findings": [{"rule_key": "TEST.RULE.A"}]}),
                                 fixture("passes", "passed")])
    evaluators = {"mandatory_particular": lambda f: fr.Evaluation("failed", findings=[{"rule_key": f.rule_key}])}
    report = fr.run(store, RULESET, synth, golden, evaluators=evaluators,
                    label_evaluator=lambda kind, name, data: fr.Evaluation(
                        "passed", findings=[{"panel": 0, "result": "matched"}, {"panel": 1, "result": "matched"}]))
    by_item = {r.item: r for r in report.results if r.kind == "rule_fixture"}
    assert by_item["fails"].result == "matched"
    assert by_item["passes"].result == "differed"
    assert by_item["fails"].language == "sv"
    assert not report.passed


def test_the_run_passes_only_when_everything_matched(dirs):
    synth, golden = dirs
    store = FakeStore([MEMBER], [fixture("fails", "failed"), fixture("withholds", "withheld",
                                                                     expected={"reason": "data_missing"})])
    calls = iter([fr.Evaluation("failed"), fr.Evaluation("withheld", reason="data_missing")])
    report = fr.run(store, RULESET, synth, golden, evaluators={"mandatory_particular": lambda f: next(calls)},
                    label_evaluator=lambda kind, name, data: fr.Evaluation(
                        "passed", findings=[{"panel": 0, "result": "matched"}, {"panel": 1, "result": "matched"}]))
    assert [r.result for r in report.results] == ["matched"] * 4
    assert report.passed


def test_a_withheld_reason_that_differs_is_differed(dirs):
    synth, _ = dirs
    store = FakeStore([MEMBER], [fixture("w", "withheld", expected={"reason": "data_missing"})])
    report = fr.run(store, RULESET, synth, Path("/nonexistent"),
                    evaluators={"mandatory_particular": lambda f: fr.Evaluation("withheld", reason="panel_outlined")})
    assert report.results[0].result == "differed"


def test_an_evaluator_error_is_withheld_never_passed(dirs):
    synth, golden = dirs

    def boom(f):
        raise RuntimeError("label text must not leak")

    report = fr.run(FakeStore([MEMBER], [fixture("x", "passed")]), RULESET, synth, golden,
                    evaluators={"mandatory_particular": boom})
    [r] = [r for r in report.results if r.kind == "rule_fixture"]
    assert (r.result, r.reason) == ("withheld", "evaluator_error:RuntimeError")
    assert not report.passed


def test_a_member_without_fixtures_is_withheld_with_no_fixtures(dirs):
    synth, golden = dirs
    other = fr.Member("TEST.RULE.B", 2, "prescribed_wording")
    report = fr.run(FakeStore([MEMBER, other], [fixture("a")]), RULESET, synth, golden, evaluators={})
    [r] = [r for r in report.results if r.reason == fr.NO_FIXTURES]
    assert (r.rule_key, r.rule_version, r.result) == ("TEST.RULE.B", 2, "withheld")


def test_an_empty_ruleset_does_not_pass(tmp_path):
    report = fr.run(FakeStore(), RULESET, tmp_path / "none", tmp_path / "none")
    assert report.results == [] and not report.passed


def test_golden_labels_are_read_per_panel_and_never_written(tmp_path):
    golden = tmp_path / "golden"
    golden.mkdir()
    (golden / "README.md").write_text("people only")
    (golden / "pilot-a.expected.json").write_text(json.dumps({"panels": [
        {"index": 0, "language": "da", "particulars": ["batch"], "findings": [{"rule_key": "X"}]}]}))
    (golden / "pilot-a.pdf").write_bytes(b"%PDF-1.7")
    (golden / "broken.json").write_text("{not json")
    before = {p: p.stat().st_mtime_ns for p in golden.iterdir()}
    results = fr.run_golden(golden)
    assert [(r.item, r.panel, r.language, r.result, r.reason) for r in results] == [
        ("broken.json", None, None, "withheld", fr.FIXTURE_INVALID),
        ("pilot-a.expected.json", 0, "da", "withheld", fr.ENGINE_UNAVAILABLE),
        ("pilot-a.pdf", None, None, "withheld", fr.ENGINE_UNAVAILABLE)]
    assert results[1].expected == {"particulars": ["batch"], "findings": [{"rule_key": "X"}]}
    assert {p: p.stat().st_mtime_ns for p in golden.iterdir()} == before


def test_an_unreadable_synthetic_truth_file_is_withheld_as_invalid(tmp_path):
    (tmp_path / "bad.truth.json").write_text("[]")
    [r] = fr.run_synthetic(tmp_path)
    assert (r.item, r.result, r.reason) == ("bad", "withheld", fr.FIXTURE_INVALID)


def test_the_generated_synthetic_labels_report_every_panel():
    if not list(fr.SYNTH_DIR.glob("*.truth.json")):
        pytest.skip("run make fixtures first")
    results = fr.run_synthetic(fr.SYNTH_DIR)
    names = {r.item for r in results}
    assert {"clean_3lang", "missing_batch", "mixed_9panels"} <= names
    assert len([r for r in results if r.item == "mixed_9panels"]) == 9
    assert all(r.result == "withheld" and r.language for r in results)


def test_json_and_junit_reports_are_machine_readable(dirs):
    synth, golden = dirs
    report = fr.run(FakeStore([MEMBER], [fixture("a")]), RULESET, synth, golden, evaluators={})
    data = json.loads(json.dumps(report.to_dict()))
    assert data["ruleset_version"] == RULESET and data["passed"] is False
    assert data["summary"]["withheld"] == 3 and data["summary"]["by_kind"]["synthetic"]["withheld"] == 2
    assert {"kind", "item", "panel", "language", "result", "expected", "actual", "reason"} <= set(data["results"][0])
    suite = ET.fromstring(fr.to_junit(report))
    assert suite.get("tests") == "3" and suite.get("skipped") == "3" and suite.get("failures") == "0"
    assert len(suite.findall("testcase/skipped")) == 3


# ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

class FakeConn:
    def execute(self, *a, **k):
        return self

    def transaction(self):
        import contextlib
        return contextlib.nullcontext()

    def close(self):
        pass


@pytest.fixture
def cli_env(monkeypatch, tmp_path):
    for name in ("SENTRY_DSN_WORKER", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://fixtures-test.invalid/db")
    monkeypatch.setattr(db, "connect", lambda dsn: FakeConn())
    return write_synth(tmp_path / "synth"), tmp_path / "golden"


def test_cli_prints_json_on_stdout_and_exits_1_when_not_passed(cli_env, monkeypatch, capsys, tmp_path):
    synth, golden = cli_env
    monkeypatch.setattr(fr, "PgFixtureStore", lambda conn: FakeStore([MEMBER], [fixture("a")]))
    out, junit = tmp_path / "r.json", tmp_path / "r.xml"
    code = cli.main(["fixtures", "run", "--ruleset", RULESET, "--format", "json", "--out", str(out),
                     "--junit", str(junit), "--synth", str(synth), "--golden", str(golden)])
    assert code == 1
    printed = json.loads(capsys.readouterr().out)        # stdout is the report alone
    assert printed == json.loads(out.read_text())
    assert printed["results"][0]["reason"] == fr.EVALUATOR_MISSING
    assert ET.parse(junit).getroot().get("skipped") == "3"


def test_cli_exits_2_for_an_unknown_ruleset(cli_env, monkeypatch, capsys):
    synth, golden = cli_env
    monkeypatch.setattr(fr, "PgFixtureStore", lambda conn: FakeStore(known=False))
    assert cli.main(["fixtures", "run", "--ruleset", "nope", "--synth", str(synth), "--golden", str(golden)]) == 2
    assert "no released ruleset nope" in capsys.readouterr().err


def test_cli_exits_2_without_a_database(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert cli.main(["fixtures", "run", "--ruleset", RULESET]) == 2
    assert "DATABASE_URL" in capsys.readouterr().err


def test_cli_text_output_names_every_withhold(cli_env, monkeypatch, capsys):
    synth, golden = cli_env
    monkeypatch.setattr(fr, "PgFixtureStore", lambda conn: FakeStore([MEMBER], [fixture("a")]))
    assert cli.main(["fixtures", "run", "--ruleset", RULESET, "--synth", str(synth), "--golden", str(golden)]) == 1
    text = capsys.readouterr().out
    assert text.startswith(f"ruleset {RULESET}: NOT PASSED (0 matched, 0 differed, 3 withheld of 3)")
    assert "missing_batch panel 1 [sv]: engine_unavailable" in text
    assert "no rule fixture was evaluated" in text


# ── Postgres ──────────────────────────────────────────────────────────────────────────────────────────

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")


@pytest.fixture
def pg():
    try:
        conn = db.connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database (the CI worker job has none until T-009); run make db-start")
    yield conn
    conn.close()


def test_pg_store_refuses_an_unknown_ruleset(pg):
    with pytest.raises(fr.UnknownRuleset):
        fr.PgFixtureStore(pg).members("t206-does-not-exist")


def test_pg_store_queries_run_in_a_read_only_transaction(pg):
    pg.execute("set session characteristics as transaction read only")
    with pg.transaction():
        assert fr.PgFixtureStore(pg).fixtures("t206-does-not-exist") == []
    with pytest.raises(psycopg.errors.ReadOnlySqlTransaction), pg.transaction():
        pg.execute("create table public.t206_probe (x int)")


def test_default_dirs_are_the_repository_fixtures():
    root = Path(__file__).resolve().parents[2]
    assert (fr.SYNTH_DIR, fr.GOLDEN_DIR) == (root / "fixtures" / "synth" / "out", root / "fixtures" / "golden")


def test_pg_store_reads_members_fixtures_and_shapes_of_a_released_ruleset(pg):
    """Synthetic reference rows, inserted and rolled back in one transaction: nothing is left behind."""
    with pg.transaction():
        person = pg.execute("insert into app.people (display_name) values ('T-206 test') returning id").fetchone()["id"]
        for key, shape in (("TEST.T206.A", "mandatory_particular"), ("TEST.T206.B", "prescribed_wording")):
            pg.execute("insert into ref.rules (rule_key, shape, domain, node_id, title)"
                       " values (%s, %s, 'mandatory_particulars', 'EU', 'synthetic test rule')", (key, shape))
            pg.execute("insert into ref.rule_versions (rule_key, version, status, article_ref, source_excerpt,"
                       " accepted_by, accepted_at) values (%s, 1, 'accepted', 'synthetic', 'synthetic', %s, now())",
                       (key, person))
        pg.execute("insert into ref.ruleset_versions (id) values ('t206-test')")
        pg.execute("insert into ref.ruleset_members (ruleset_version, rule_key, version)"
                   " values ('t206-test', 'TEST.T206.A', 1), ('t206-test', 'TEST.T206.B', 1)")
        pg.execute("""insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome)
                      values ('TEST.T206.A', 1, 'absent on sv', '{"panel": {"language": "sv"}}', 'failed')""")
        store = fr.PgFixtureStore(pg)
        assert store.members("t206-test") == [fr.Member("TEST.T206.A", 1, "mandatory_particular"),
                                              fr.Member("TEST.T206.B", 1, "prescribed_wording")]
        report = fr.run(store, "t206-test", Path("/nonexistent"), Path("/nonexistent"), evaluators={})
        assert [(r.item, r.language, r.result, r.reason) for r in report.results] == [
            ("TEST.T206.B", None, "withheld", fr.NO_FIXTURES),
            ("absent on sv", "sv", "withheld", fr.EVALUATOR_MISSING)]
        raise psycopg.Rollback()
    assert pg.execute("select count(*) as n from ref.rules where rule_key like 'TEST.T206.%'").fetchone()["n"] == 0
