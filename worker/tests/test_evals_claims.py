"""T-501: the claims evaluation harness. A scripted fake model only; nothing here reaches the network or a real model.
The pg test reads a claim rule version from the local database inside a transaction that is rolled back."""
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pgtest import DSN, connect_or_skip

from nutrivo_worker import cli
from nutrivo_worker import observability as obs
from nutrivo_worker.config import WORKER_ROOT, Settings
from nutrivo_worker.db import connect
from nutrivo_worker.evals import claims
from nutrivo_worker.models import PURPOSES, Models, Raw, load_prompt

PROMPTS = WORKER_ROOT / "prompts"
NOW = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
_CLAIM = re.compile(r'<data name="claim_text">\n(.*?)\n</data>', re.DOTALL)


def answer(judgement="permitted", confidence=0.9, abstain=False, reason="The text names no colour."):
    return json.dumps({"abstain": abstain, "judgement": judgement, "confidence": confidence, "reason": reason})


class ScriptedModel:
    """Answers by the printed claim text; anything unscripted is an abstention."""

    name = "bedrock"

    def __init__(self, script=None, stop_reason="end_turn", fail=False):
        self.script, self.stop_reason, self.fail = script or {}, stop_reason, fail
        self.calls = []

    def model_for(self, model_class):
        return {"judgement": "eu.judge"}.get(model_class)

    def complete(self, model_id, system, user, schema, max_tokens):
        self.calls.append({"model_id": model_id, "system": system, "user": user, "schema": schema})
        if self.fail:
            raise ConnectionError("provider down")
        claim = _CLAIM.search(user).group(1)
        text = self.script.get(claim, answer(None, 0.0, abstain=True))
        return Raw(self.name, model_id, text, self.stop_reason, 200, 30)


def make_models(tmp_path, provider):
    return Models(Settings(prompts_dir=PROMPTS, cassette_dir=tmp_path / "cassettes"), [provider])


class NotFound(Exception):
    status_code = 404


class FakeApi:
    """Stands in for the v4 client's REST surface (client.api.*); records every request."""

    def __init__(self, fail_on=(), datasets=()):
        self.requests, self.fail_on, self.existing = [], set(fail_on), set(datasets)
        for name in ("datasets", "dataset_items", "dataset_run_items", "scores"):
            setattr(self, name, SimpleNamespace(create=self._recorder(name)))
        self.datasets.get = self._get

    def _get(self, dataset_name):
        self.requests.append(("datasets.get", {"dataset_name": dataset_name}))
        if "datasets.get" in self.fail_on:
            raise ConnectionError("langfuse down")
        if dataset_name not in self.existing:
            raise NotFound()
        return SimpleNamespace(name=dataset_name)

    def _recorder(self, name):
        def create(**kwargs):
            if name in self.fail_on:
                raise ConnectionError("langfuse down")
            self.requests.append((name, kwargs))
            if name == "dataset_run_items":
                return SimpleNamespace(dataset_run_id="run-" + kwargs["run_name"][:8])
            return SimpleNamespace(id=kwargs.get("id"))
        return create

    def of(self, name):
        return [kw for n, kw in self.requests if n == name]


def recorder(api=None, send=True):
    client = obs.langfuse()
    rec = claims.LangfuseRecorder(client, send=send)
    rec.client = SimpleNamespace(api=api or FakeApi(), start_as_current_observation=client.start_as_current_observation)
    return rec


def spec(min_confidence=0.7, examples=(), synthetic=False, key="TEST.T501.CLAIMS"):
    return claims.RuleSpec.from_params(key, 1, "candidate", {
        "question": "Q?", "criteria": ["c1"], "examples": list(examples), "min_confidence": min_confidence},
        synthetic=synthetic)


def case(i, label="permitted", text=None, lang="sv", key="TEST.T501.CLAIMS", synthetic=False):
    return claims.Case(f"c{i}", lang, text or f"påstående {i}", label, key, None if synthetic else "person",
                       None if synthetic else "test source", synthetic)


def write(path, rows):
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    return path


HUMAN = {"id": "h1", "rule_key": "K", "text": "Med kyckling", "label": "permitted", "labelled_by": "A. Person",
         "source": "32009R0767 Art. 11(1), accepted term T.1"}


# ── The prompt and the model call ───────────────────────────────────────────────────────────────────
def test_claim_judgement_prompt_v1_is_on_the_judgement_class_and_carries_no_law():
    p = load_prompt("claim_judgement", "v1", PROMPTS)
    assert p.header["model class"] == PURPOSES["claim_judgement"] == "judgement"
    assert "Do not" in p.system and "translate" in p.system and "abstain" in p.system
    assert not re.search(r"\b(Reg\.|Regulation|Article|Art\.|\d{3,4}/\d{4})", p.system)


def test_the_printed_string_reaches_the_model_unchanged_in_its_own_language(tmp_path):
    text = "Ger blank päls – 100 % naturligt!"
    provider = ScriptedModel({text: answer("needs_evidence")})
    s = spec(examples=[{"lang": "sv", "text": "Med lax", "label": "permitted"},
                       {"lang": "de", "text": "Mit Lachs", "label": "permitted"},
                       {"text": "Any language", "label": "prohibited"}])
    r = claims.judge(make_models(tmp_path, provider), s, case(1, "needs_evidence", text))
    assert (r.predicted, r.agrees, r.model_id) == ("needs_evidence", True, "eu.judge")
    user = provider.calls[0]["user"]
    assert f'<data name="claim_text">\n{text}\n</data>' in user
    assert '<data name="panel_language">\nsv\n</data>' in user
    examples = json.loads(re.search(r'<data name="examples">\n(.*?)\n</data>', user, re.DOTALL).group(1))
    assert [e["text"] for e in examples] == ["Med lax", "Any language"]      # never the German example
    assert "Mit Lachs" not in user and "translation" not in user


@pytest.mark.parametrize(("raw", "kwargs", "reason"), [
    (answer(None, 0.0, abstain=True), {}, "model_abstained"),
    (answer("permitted", 0.95, abstain=True), {}, "model_abstained"),       # abstaining wins over any judgement
    (answer("permitted", 0.69), {}, "model_abstained"),                     # below min_confidence 0.7
    (answer("permitted", 1.5), {}, "model_output_invalid"),
    ('{"judgement": "permitted"}', {}, "model_output_invalid"),
    (answer(), {"stop_reason": "refusal"}, "model_refused"),
    (answer(), {"fail": True}, "model_unavailable"),
])
def test_abstention_low_confidence_and_model_errors_are_withheld_and_never_agree(tmp_path, raw, kwargs, reason):
    c = case(1, "permitted")
    r = claims.judge(make_models(tmp_path, ScriptedModel({c.text: raw}, **kwargs)), spec(), c)
    assert (r.predicted, r.reason, r.agrees) == ("withheld", reason, False)


# ── Evaluation sets ─────────────────────────────────────────────────────────────────────────────────
def test_a_human_labelled_set_loads_with_its_source_and_labeller(tmp_path):
    [c] = claims.load_cases(write(tmp_path / "sv.jsonl", [HUMAN]), synthetic=False)
    assert (c.lang, c.labelled_by, c.source, c.synthetic) == ("sv", "A. Person", HUMAN["source"], False)


@pytest.mark.parametrize(("rows", "name", "synthetic", "match"), [
    ([{**HUMAN, "source": ""}], "sv", False, "needs source"),
    ([{k: v for k, v in HUMAN.items() if k != "labelled_by"}], "sv", False, "needs labelled_by"),
    ([{**HUMAN, "synthetic": True}], "sv", False, "separate files"),
    ([HUMAN], "sv", True, "separate files"),
    ([{**HUMAN, "label": "clear"}], "sv", False, "label must be"),
    ([HUMAN, {**HUMAN, "text": "Annat"}], "sv", False, "duplicate id"),
    ([HUMAN, {**HUMAN, "id": "h2", "text": "  med KYCKLING "}], "sv", False, "same text"),
    ([{**HUMAN, "lang": "da"}], "sv", False, "lang differs"),
    ([{**HUMAN, "translation": "With chicken"}], "sv", False, "unknown fields"),
    ([HUMAN], "swedish", False, "two-letter"),
])
def test_malformed_or_unsourced_cases_refuse_the_whole_set(tmp_path, rows, name, synthetic, match):
    with pytest.raises(claims.EvalSetInvalid, match=match):
        claims.load_cases(write(tmp_path / f"{name}.jsonl", rows), synthetic=synthetic)


def test_the_committed_synthetic_set_is_marked_synthetic_and_tests_no_law():
    rule = claims.load_synthetic_rule()
    assert rule.synthetic and rule.rule_key.startswith("HARNESS.SYNTHETIC.") and rule.status == "synthetic"
    sets = claims.load_sets(claims.SYNTHETIC_DIR, ["da", "de", "en", "sv"], synthetic=True)
    assert all(c.synthetic and c.rule_key == rule.rule_key for cs in sets.values() for c in cs)
    assert {lang: len(cs) for lang, cs in sets.items()} == {"da": 3, "de": 3, "en": 4, "sv": 4}
    with pytest.raises(claims.EvalSetInvalid, match="no evaluation set"):
        claims.load_sets(claims.SYNTHETIC_DIR, ["fi"], synthetic=True)


@pytest.mark.parametrize(("params", "match"), [
    ({"criteria": ["c"], "min_confidence": 0.7}, "question"),
    ({"question": "Q?", "min_confidence": 0.7}, "criteria"),
    ({"question": "Q?", "criteria": "c"}, "min_confidence"),
    ({"question": "Q?", "criteria": "c", "min_confidence": 0}, "min_confidence"),
    ({"question": "Q?", "criteria": "c", "min_confidence": True}, "min_confidence"),
    ({"question": "Q?", "criteria": "c", "min_confidence": 0.7, "examples": [{"text": "x"}]}, "examples"),
])
def test_a_rule_without_complete_claim_judgement_params_is_refused(params, match):
    with pytest.raises(claims.RuleSpecInvalid, match=match):
        claims.RuleSpec.from_params("K", 1, "candidate", params)


# ── Agreement and the threshold ─────────────────────────────────────────────────────────────────────
def test_cohen_kappa_against_known_values_and_undefined_cases():
    assert claims.cohen_kappa([("permitted", "permitted"), ("prohibited", "prohibited")]) == 1.0
    # 2x2 textbook case: po = 0.7, pe = 0.5 → kappa 0.4
    pairs = ([("permitted", "permitted")] * 20 + [("permitted", "prohibited")] * 5
             + [("prohibited", "permitted")] * 10 + [("prohibited", "prohibited")] * 15)
    assert claims.cohen_kappa(pairs) == pytest.approx(0.4)
    assert claims.cohen_kappa([]) is None
    assert claims.cohen_kappa([("permitted", "permitted")] * 60) is None     # chance agreement 1: undefined
    # withheld is its own category: it lowers kappa rather than dropping the case
    assert claims.cohen_kappa(pairs[:-1] + [("prohibited", "withheld")]) < 0.4


def perfect(n, labels=("permitted", "prohibited", "needs_evidence")):
    return [claims.CaseResult(f"c{i}", labels[i % len(labels)], labels[i % len(labels)]) for i in range(n)]


def test_fifty_agreeing_human_labelled_cases_meet_the_threshold():
    *_, passed, reasons = claims.gate(perfect(50), synthetic=False)
    assert passed and reasons == []


def test_too_few_cases_low_kappa_and_synthetic_sets_never_meet_the_threshold():
    assert claims.gate(perfect(49), synthetic=False)[-1] == ["too_few_cases"]
    assert claims.gate(perfect(60), synthetic=True)[-1] == ["synthetic_set"]
    withheld = [claims.CaseResult(r.id, r.label, "withheld", "model_abstained") if i % 4 == 0 else r
                for i, r in enumerate(perfect(60))]
    _, kappa, n_withheld, _, passed, reasons = claims.gate(withheld, synthetic=False)
    assert (n_withheld, passed, reasons) == (15, False, ["kappa_below_threshold"]) and kappa < 0.8


def test_one_prohibited_claim_judged_permitted_fails_whatever_the_kappa():
    results = perfect(99) + [claims.CaseResult("bad", "prohibited", "permitted")]
    _, kappa, _, pjp, passed, reasons = claims.gate(results, synthetic=False)
    assert kappa > 0.95 and pjp == 1 and not passed and reasons == ["prohibited_judged_permitted"]


# ── The run and its Langfuse dataset run ────────────────────────────────────────────────────────────
def test_a_run_records_a_dataset_run_with_case_and_run_scores(tmp_path):
    cases = [case(1, "permitted"), case(2, "prohibited"), case(3, "needs_evidence")]
    provider = ScriptedModel({cases[0].text: answer("permitted"), cases[1].text: answer("permitted", 0.8)})
    api = FakeApi()
    report = claims.run(make_models(tmp_path, provider), spec(), {"sv": cases}, recorder(api), now=NOW)
    [sv] = report.languages
    assert [(c.id, c.predicted, c.reason) for c in sv.cases] == [
        ("c1", "permitted", None), ("c2", "permitted", None), ("c3", "withheld", "model_abstained")]
    assert (sv.n, sv.withheld, sv.prohibited_judged_permitted, sv.passed) == (3, 1, 1, False)
    assert sv.reasons == ["too_few_cases", "kappa_below_threshold", "prohibited_judged_permitted"]
    assert report.run_name == "TEST.T501.CLAIMS@v1 claim_judgement.v1 2026-10-24T09:00:00Z"

    [ds] = api.of("datasets")
    assert ds["name"] == sv.dataset == "claims/TEST.T501.CLAIMS/sv"
    assert api.of("datasets.get") == [{"dataset_name": "claims%2FTEST.T501.CLAIMS%2Fsv"}]   # read first, then create
    items = api.of("dataset_items")
    assert [i["expected_output"] for i in items] == [{"label": c.label} for c in cases]
    assert items[0]["input"] == {"claim_text": cases[0].text, "panel_language": "sv"}
    links = api.of("dataset_run_items")
    assert [li["dataset_item_id"] for li in links] == [i["id"] for i in items]
    assert all(li["run_name"] == report.run_name and len(li["trace_id"]) == 32 for li in links)
    assert len({li["trace_id"] for li in links}) == 3
    scores = api.of("scores")
    per_case = [(s["name"], s["value"]) for s in scores if "trace_id" in s]
    assert per_case == [("agreement", 1.0), ("outcome", "permitted"), ("agreement", 0.0), ("outcome", "permitted"),
                        ("agreement", 0.0), ("outcome", "withheld")]
    per_run = {s["name"]: s["value"] for s in scores if "dataset_run_id" in s}
    assert per_run["n"] == 3 and per_run["withheld"] == 1 and per_run["prohibited_judged_permitted"] == 1
    assert per_run["threshold_passed"] == 0.0 and "kappa" in per_run
    assert sv.dataset_run_id == "run-" + report.run_name[:8]
    assert report.complete and not report.passed and report.langfuse_sent

    # A rerun of the same cases upserts the same items; its scores carry new ids under the new run name.
    api2 = FakeApi(datasets={"claims%2FTEST.T501.CLAIMS%2Fsv"})
    claims.run(make_models(tmp_path, provider), spec(), {"sv": cases}, recorder(api2),
               now=NOW.replace(hour=10))
    assert [i["id"] for i in api2.of("dataset_items")] == [i["id"] for i in items] and api2.of("datasets") == []
    assert not {s["id"] for s in api2.of("scores")} & {s["id"] for s in scores}


def test_without_langfuse_keys_nothing_is_sent_and_the_report_is_the_same(tmp_path):
    cases = [case(1)]
    provider = ScriptedModel({cases[0].text: answer()})
    api = FakeApi()
    report = claims.run(make_models(tmp_path, provider), spec(), {"sv": cases}, recorder(api, send=False), now=NOW)
    assert api.requests == [] and report.languages[0].cases[0].agrees and report.complete
    assert report.to_dict()["langfuse"] == {"sent": False, "failures": 0}


def test_a_failed_langfuse_request_leaves_the_run_incomplete_and_the_judgements_unchanged(tmp_path):
    cases = [case(1)]
    provider = ScriptedModel({cases[0].text: answer()})
    report = claims.run(make_models(tmp_path, provider), spec(), {"sv": cases},
                        recorder(FakeApi(fail_on={"scores"})), now=NOW)
    assert report.languages[0].cases[0].agrees and report.langfuse_failures == 7 and not report.complete
    other = claims.run(make_models(tmp_path, provider), spec(), {"sv": cases},
                       recorder(FakeApi(fail_on={"datasets.get"})), now=NOW)
    assert other.langfuse_failures == 1 and not other.complete       # a failed read is not taken as "missing"


def test_rule_examples_are_never_graded_as_cases(tmp_path):
    s = spec(examples=[{"lang": "sv", "text": "Påstående 1", "label": "permitted"}])
    provider = ScriptedModel()
    [sv] = claims.run(make_models(tmp_path, provider), s, {"sv": [case(1), case(2)]}, recorder(), now=NOW).languages
    assert sv.excluded == [{"id": "c1", "reason": "example_overlap"}] and [c.id for c in sv.cases] == ["c2"]


def test_synthetic_cases_run_only_against_the_synthetic_rule(tmp_path):
    with pytest.raises(claims.EvalSetInvalid, match="synthetic"):
        claims.run(make_models(tmp_path, ScriptedModel()), spec(), {"sv": [case(1, synthetic=True)]}, recorder())


def test_each_case_is_a_trace_holding_the_models_generation(tmp_path):
    exporter = InMemorySpanExporter()
    obs.init_langfuse(Settings(langfuse_public_key="pk-lf-evals", langfuse_secret_key="sk-lf-evals"),
                      span_exporter=exporter)
    try:
        c = case(1)
        claims.run(make_models(tmp_path, ScriptedModel({c.text: answer()})), spec(), {"sv": [c]}, recorder(),
                   now=NOW)
        obs.langfuse().flush()
        spans = {s.name: s for s in exporter.get_finished_spans()}
        trace = next(s for name, s in spans.items() if name.startswith("eval:claims:TEST.T501.CLAIMS:sv:c1:"))
        gen = spans["claim_judgement"]
        assert gen.context.trace_id == trace.context.trace_id and gen.parent.span_id == trace.context.span_id
        assert gen.attributes["langfuse.observation.type"] == "generation"
        assert gen.attributes["langfuse.observation.model.name"] == "eu.judge"
    finally:
        obs.init_langfuse(Settings())


# ── The command line ────────────────────────────────────────────────────────────────────────────────
def test_cli_runs_the_synthetic_harness_and_prints_the_report(tmp_path, monkeypatch, capsys):
    sets = claims.load_sets(claims.SYNTHETIC_DIR, ["sv", "de"], synthetic=True)
    script = {c.text: answer(c.label) for cs in sets.values() for c in cs}
    provider = ScriptedModel(script)
    monkeypatch.setattr(cli.models, "configure", lambda settings: make_models(tmp_path, provider))
    out = tmp_path / "report.json"
    code = cli.main(["evals", "claims", "--synthetic", "--lang", "sv", "--lang", "de", "--out", str(out)])
    report = json.loads(capsys.readouterr().out)
    assert code == 0 and json.loads(out.read_text()) == report
    assert report["synthetic"] and not report["passed"] and report["complete"]
    assert [(r["lang"], r["n"], r["agreement"], r["reasons"], r["note"]) for r in report["languages"]] == [
        ("de", 3, 1.0, ["synthetic_set", "too_few_cases"], "synthetic harness cases, not law"),
        ("sv", 4, 1.0, ["synthetic_set", "too_few_cases"], "synthetic harness cases, not law")]
    assert report["models"] == ["eu.judge"] and report["langfuse"] == {"sent": False, "failures": 0}


def test_cli_refuses_a_missing_set_with_exit_2(monkeypatch, capsys):
    assert cli.main(["evals", "claims", "--synthetic", "--lang", "fi"]) == 2
    assert "no evaluation set fi.jsonl" in capsys.readouterr().err


# ── The rule version, read from ref ─────────────────────────────────────────────────────────────────
def test_the_rule_version_is_read_from_ref_and_never_a_rejected_or_other_shape(monkeypatch):
    pg = connect_or_skip(connect, DSN)
    params = {"question": "Q?", "criteria": ["c"], "min_confidence": 0.8,
              "examples": [{"lang": "sv", "text": "x", "label": "permitted"}]}
    try:
        with pg.transaction():
            for key, shape in (("TEST.T501.A", "claim_judgement"), ("TEST.T501.B", "mandatory_particular")):
                pg.execute("insert into ref.rules (rule_key, shape, domain, node_id, title)"
                           " values (%s, %s, 'claims_wording', 'EU', 'synthetic test rule')", (key, shape))
            for key, version, status in (("TEST.T501.A", 1, "candidate"), ("TEST.T501.A", 2, "rejected"),
                                         ("TEST.T501.B", 1, "candidate")):
                pg.execute("insert into ref.rule_versions (rule_key, version, status, params, article_ref)"
                           " values (%s, %s, %s, %s, 'synthetic')", (key, version, status, json.dumps(params)))
            reader = claims.PgRuleReader(pg)
            got = reader.claim_rule("TEST.T501.A", None)
            assert (got.rule_key, got.version, got.status, got.min_confidence) == ("TEST.T501.A", 1, "candidate", 0.8)
            assert reader.claim_rule("TEST.T501.A", 2) is None              # rejected
            assert reader.claim_rule("TEST.T501.B", None) is None           # not a claim rule
            assert reader.claim_rule("TEST.T501.NONE", None) is None
            raise psycopg.Rollback()
        assert pg.execute("select count(*) as n from ref.rules where rule_key like 'TEST.T501.%'").fetchone()["n"] == 0
    finally:
        pg.close()


def test_default_dirs_are_the_repository_eval_sets():
    assert claims.EVALS_DIR == Path(__file__).resolve().parents[1] / "evals" / "claims"
