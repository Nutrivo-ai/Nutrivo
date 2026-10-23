"""T-207 (J01): the source watch and its model triage, offline against CELLAR answers recorded from the live endpoint
(tests/recordings/watch/README.md) and a scripted fake model. Nothing here reaches the network or a real model."""
import json
import re
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fakes import FakeStore

from nutrivo_worker import cli
from nutrivo_worker.config import WORKER_ROOT, Settings
from nutrivo_worker.models import Models, Raw, load_prompt, output_json_schema
from nutrivo_worker.sources import horizon, watch
from nutrivo_worker.sources.fetch import Act
from nutrivo_worker.sources.http import PoliteClient, ReplayTransport, Response
from nutrivo_worker.sources.watch import Triage

REC = Path(__file__).parent / "recordings" / "watch"
ACTS = [Act("32009R0767", "Regulation (EC) No 767/2009 on the placing on the market and use of feed"),
        Act("32020R0354", "Commission Regulation (EU) 2020/354 establishing the list of intended uses of feed for "
                          "particular nutritional purposes")]
SINCE, TODAY = date(2025, 10, 1), date(2026, 10, 23)
NOW = datetime(2026, 10, 23, 6, 0, tzinfo=UTC)
PROPOSAL = "52025PC1030"


def client(transport=None):
    return PoliteClient(transport or ReplayTransport(REC), min_interval_s=0.0, sleep=lambda s: None)


def answer(relevance="medium", summary="A document on feed.", reason="It cites the feed marketing act.",
           abstain=False, **extra):
    return json.dumps({"abstain": abstain, "relevance": relevance, "summary": summary, "reason": reason, **extra})


class ScriptedModel:
    """A fake provider: the answer for a document is looked up by its CELEX id in the rendered input."""

    name = "bedrock"

    def __init__(self, answers=None, default=None, stop_reason="end_turn", fail=False):
        self.answers, self.default, self.stop_reason, self.fail = answers or {}, default or answer(), stop_reason, fail
        self.calls = []

    def model_for(self, model_class):
        return {"triage": "eu.triage"}.get(model_class)

    def complete(self, model_id, system, user, schema, max_tokens):
        celex = re.search(r'"celex":"([^"]+)","document_kind"', user).group(1)
        self.calls.append({"celex": celex, "model_id": model_id, "system": system, "user": user, "schema": schema})
        if self.fail:
            raise ConnectionError("provider down")
        return Raw(self.name, model_id, self.answers.get(celex, self.default), self.stop_reason, 300, 60)


def models(provider):
    return Models(Settings(models_mode="live"), [provider])


def run(provider, store=None, **kw):
    kw.setdefault("today", TODAY)
    return watch.run(ACTS, client(), models(provider), run_id="run-1", since=SINCE, store=store,
                     now=lambda: NOW, **kw)


def keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from keys(v)


# ── acceptance ─────────────────────────────────────────────────────────────────────────────────────
def test_J01_main_watch_finds_new_documents_and_triage_ranks_them_for_a_person(tmp_path):
    provider = ScriptedModel({
        PROPOSAL: answer("high", "A Commission proposal to amend Regulation (EC) No 767/2009 and other feed acts.",
                         "It proposes changes to the feed marketing act."),
        "52026XC01807": answer("medium", "Commission guidance on feed homogeneity and cross-contamination.",
                               "Feed manufacturing guidance."),
    }, default=answer("low", "A notice on a geographical indication.", "Not about pet food."))
    store = FakeStore()
    report = run(provider, store)

    # 1. the scripts polled CELLAR (EUR-Lex and the OJ) for each followed act
    assert report.failures == [] and report.acts == ["32009R0767", "32020R0354"]
    by = {i.celex: i for i in report.items}
    assert {PROPOSAL, "52025PC1030(01)", "32026H1801", "22026D0683", "32020R0354R(07)"} <= set(by)
    assert by[PROPOSAL].relations == ["cites 32009R0767"] and by["32020R0354R(07)"].relations == ["corrects 32020R0354"]
    assert by[PROPOSAL].kind == "proposal" and by["32026H1801"].kind == "legal_act"
    assert by["32020R0354R(07)"].kind == "corrigendum" and by["52025AE3145"].kind == "preparatory"
    assert all(i.document_date >= SINCE.isoformat() for i in report.items)

    # 2. a model triaged each titled item, through nutrivo_worker.models, one app.model_calls row each
    titled = [i for i in report.items if i.title]
    assert len(provider.calls) == len(titled) == len(store.model_calls)
    assert {r["purpose"] for r in store.model_calls} == {"triage"}
    assert {r["prompt_version"] for r in store.model_calls} == {"triage.v1"}
    assert by[PROPOSAL].status == "triaged" and by[PROPOSAL].relevance == "high"
    assert by["32020R0354R(07)"].status == "withheld" and by["32020R0354R(07)"].withheld_reason == "no_title"

    # 3. the report a person reads: ranked, with the official status from the CELEX id and the reader link
    order = [i.relevance or i.status for i in report.items]
    assert order == sorted(order, key=lambda r: {"high": 0, "withheld": 1, "medium": 2, "low": 3}[r])
    assert report.items[0].celex == PROPOSAL
    d = report.as_dict()
    assert d["summary"]["high"] == 1 and d["summary"]["withheld"] == 2 and d["summary"]["failed_acts"] == 0
    first = d["items"][0]
    assert first["official_status"] == "Commission proposal: not law"
    assert first["url"] == "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:52025PC1030"

    # 4. a person records the proposal from the report; stage and date are theirs
    path = tmp_path / "report.json"
    path.write_text(report.to_json())
    rec = horizon.recording(horizon.report_item(path, PROPOSAL), "proposal", expected_date=date(2027, 6, 30))
    assert (rec.celex, rec.kind, rec.stage, rec.effective_from) == (PROPOSAL, "proposal", "proposal", None)
    assert rec.title.startswith("Proposal for a REGULATION") and rec.notes is None   # no model text is stored


def test_J01_must_1_triage_output_has_no_stage_or_date_and_rejects_one():
    """BE-37: the model cannot give a stage or an effective date: its schema has no field for either."""
    schema = output_json_schema(Triage)
    assert set(schema["properties"]) == {"abstain", "relevance", "summary", "reason"}
    assert schema["additionalProperties"] is False
    provider = ScriptedModel({PROPOSAL: answer("high", stage="in_force", effective_from="2027-01-01")})
    report = run(provider)
    item = next(i for i in report.items if i.celex == PROPOSAL)
    assert (item.status, item.withheld_reason, item.summary) == ("withheld", "model_output_invalid", None)


@pytest.mark.parametrize("summary, reason", [
    ("A Commission proposal that applies from 1 January 2027.", "model_stated_date"),
    ("A proposal amending 767/2009, expected in 2027.", "model_stated_date"),
    ("Proposal to amend the feed act; application date 2027-07-01.", "model_stated_date"),
    ("New labelling rules are now in force for pet food.", "proposal_stated_as_law"),
    ("A binding regulation on feed labelling.", "proposal_stated_as_law"),
    ("The regulation was adopted and changes pet-food labels.", "proposal_stated_as_law"),
])
def test_J01_must_1_a_proposal_never_appears_as_law_or_with_an_effective_date(summary, reason):
    """BE-37: a summary that dates a proposal or calls it law is withheld, and its words are not shown."""
    report = run(ScriptedModel({PROPOSAL: answer("high", summary)}))
    item = next(i for i in report.items if i.celex == PROPOSAL)
    assert (item.status, item.withheld_reason, item.summary, item.relevance) == ("withheld", reason, None, None)
    d = report.as_dict()
    assert not {"stage", "effective_from", "effective_date", "expected_date"} & set(keys(d))
    assert all(i["official_status"].endswith("not law") for i in d["items"] if i["kind"] == "proposal")


def test_J01_must_1_a_proposal_is_never_recorded_as_law_or_with_an_effective_date():
    item = {"celex": PROPOSAL, "kind": "proposal", "title": "Proposal for a REGULATION ..."}
    for stage in ("adopted", "published", "in_force"):
        with pytest.raises(horizon.RecordRefused) as exc:
            horizon.recording(item, stage)
        assert exc.value.reason == "proposal_as_law"
    for stage in ("proposal", "draft", "consultation"):
        with pytest.raises(horizon.RecordRefused) as exc:
            horizon.recording({**item, "kind": "legal_act"}, stage, effective_from=date(2027, 1, 1))
        assert exc.value.reason == "effective_date_on_non_law"
    act = horizon.recording({**item, "celex": "32026R0001", "kind": "legal_act"}, "published",
                            effective_from=date(2027, 1, 1))
    assert act.effective_from == date(2027, 1, 1)


# ── triage: abstain, fail, bound ───────────────────────────────────────────────────────────────────
def test_abstention_is_withheld_and_ranked_above_medium_and_low():
    provider = ScriptedModel({PROPOSAL: answer(None, "Unclear.", "Title too vague.", abstain=True),
                              "52026XC01807": answer("medium")}, default=answer("low"))
    report = run(provider)
    item = next(i for i in report.items if i.celex == PROPOSAL)
    assert (item.status, item.withheld_reason, item.relevance) == ("withheld", "model_abstained", None)
    statuses = [i.relevance or "withheld" for i in report.items]
    assert statuses.index("medium") > max(n for n, s in enumerate(statuses) if s == "withheld")


def test_a_relevance_without_abstaining_or_with_none_is_withheld():
    assert watch.guard("proposal", Triage(abstain=False, relevance=None, summary="x", reason="y")) == "model_abstained"
    assert watch.guard("proposal", Triage(abstain=True, relevance="high", summary="x", reason="y")) == "model_abstained"


def test_a_legal_act_may_be_called_in_force_but_never_dated():
    act = Triage(abstain=False, relevance="high", summary="Amends the act in force.", reason="Regulation 2017/2279.")
    assert watch.guard("legal_act", act) is None
    assert watch.guard("legal_act", act.model_copy(update={"summary": "Applies from March 2027."})) == \
        "model_stated_date"


@pytest.mark.parametrize("stop, text, reason", [
    ("refusal", None, "model_refused"), ("max_tokens", '{"abs', "model_output_invalid"),
    ("end_turn", "not json", "model_output_invalid")])
def test_unusable_model_answers_are_withheld_never_passed(stop, text, reason):
    provider = ScriptedModel(default=text, stop_reason=stop)
    store = FakeStore()
    report = run(provider, store)
    assert {i.status for i in report.items} == {"withheld"}
    assert {i.withheld_reason for i in report.items if i.title} == {reason}
    assert store.model_calls == []


def test_an_unavailable_model_withholds_every_item_and_the_run_still_reports():
    report = run(ScriptedModel(fail=True))
    assert report.failures == [] and report.items
    assert {i.withheld_reason for i in report.items if i.title} == {"model_unavailable"}


def test_model_calls_are_bounded_and_the_rest_are_listed_withheld():
    provider = ScriptedModel()
    report = run(provider, max_items=3)
    assert len(provider.calls) <= 3
    limited = [i for i in report.items if i.withheld_reason == "not_triaged_limit"]
    assert len(limited) == len(report.items) - 3


def test_documents_already_recorded_and_followed_acts_are_skipped():
    report = run(ScriptedModel(), known_celex={PROPOSAL})
    assert PROPOSAL not in {i.celex for i in report.items}
    assert not {"32009R0767", "32020R0354"} & {i.celex for i in report.items}


def test_triage_input_is_ids_kinds_and_official_titles_as_delimited_data():
    provider = ScriptedModel()
    run(provider)
    call = next(c for c in provider.calls if c["celex"] == PROPOSAL)
    assert '<data name="document">' in call["user"] and '<data name="followed_acts">' in call["user"]
    assert "2025-12-16" not in call["user"]                     # no date of ours reaches the model
    assert call["system"] == load_prompt("triage", "v1", WORKER_ROOT / "prompts").system
    assert call["model_id"] == "eu.triage"


def test_the_same_run_gives_the_same_report():
    a, b = run(ScriptedModel()).as_dict(), run(ScriptedModel()).as_dict()
    assert a == b


# ── sources ────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("celex, kind", [
    ("52025PC1030", "proposal"), ("52025PC1030(02)", "proposal"), ("52025SC1030", "preparatory"),
    ("52026XC01807", "preparatory"), ("32026H1801", "legal_act"), ("32009R0767", "legal_act"),
    ("32009R0767R(08)", "corrigendum"), ("22026D0683", "other"), ("62024CJ0001", "other"), ("junk", "other")])
def test_document_kind_comes_from_the_celex_id(celex, kind):
    assert watch.document_kind(celex) == kind


class Failing:
    def __init__(self, act, status=500):
        self.inner, self.act, self.status = ReplayTransport(REC), act, status

    def send(self, method, url, headers, body=None):
        if self.act in url and "resource_legal_amends" in url:
            return Response(self.status, {}, b"", url)
        return self.inner.send(method, url, headers, body)


def test_an_act_that_cannot_be_queried_fails_visibly_and_the_others_go_on():
    report = watch.run(ACTS, client(Failing("32020R0354", 404)), models(ScriptedModel()), run_id="r",
                       since=SINCE, today=TODAY)
    assert [(f.act, f.reason) for f in report.failures] == [("32020R0354", "http_404")]
    assert PROPOSAL in {i.celex for i in report.items}
    assert report.as_dict()["summary"]["failed_acts"] == 1


def test_a_malformed_sparql_answer_is_a_failure_not_an_empty_result():
    class Junk(Failing):
        def send(self, method, url, headers, body=None):
            if "resource_legal_amends" in url:
                return Response(200, {}, b'{"head": {}}', url)
            return self.inner.send(method, url, headers, body)

    report = watch.run(ACTS[:1], client(Junk("x")), models(ScriptedModel()), run_id="r", since=SINCE, today=TODAY)
    assert [f.reason for f in report.failures] == ["bad_sparql_answer"] and report.items == []


def test_later_consolidations_are_listed_as_official_metadata():
    report = run(ScriptedModel(), today=date(2018, 1, 1))
    later = {c["celex"] for c in report.later_consolidations}
    assert "02009R0767-20181226" in later


# ── prompt and command ─────────────────────────────────────────────────────────────────────────────
def test_the_triage_prompt_forbids_dates_law_and_coverage():
    p = load_prompt("triage", "v1", WORKER_ROOT / "prompts")
    assert p.header["model class"] == "triage"
    assert "Never state or estimate any date" in p.system and "in force" in p.system
    assert "what is covered" in p.system


def test_sources_watch_command_writes_the_report(tmp_path, monkeypatch, capsys):
    from nutrivo_worker import models as models_module

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("MODELS_MODE", "live")
    real_configure = models_module.configure
    monkeypatch.setattr(models_module, "configure", lambda s, providers=None: real_configure(s, [ScriptedModel()]))
    out = tmp_path / "r.json"
    code = cli.main(["sources", "watch", "--celex", "32009R0767", "--celex", "32020R0354", "--since", "2025-10-01",
                     "--today", "2026-10-23", "--replay", str(REC), "--out", str(out)])
    assert code == 0
    data = json.loads(out.read_text())
    assert data["run"]["prompt"] == "triage.v1" and data["summary"]["medium"] >= 1
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["out"] == str(out)


def test_horizon_record_command_refuses_a_proposal_as_law(tmp_path, capsys):
    path = tmp_path / "r.json"
    path.write_text(json.dumps({"items": [{"celex": PROPOSAL, "kind": "proposal", "title": "Proposal"}]}))
    code = cli.main(["horizon", "record", "--report", str(path), "--celex", PROPOSAL, "--stage", "in_force"])
    assert code == 3 and "proposal_as_law" in capsys.readouterr().err
    code = cli.main(["horizon", "record", "--report", str(path), "--celex", "52099PC0001", "--stage", "proposal"])
    assert code == 3 and "not_in_report" in capsys.readouterr().err
    code = cli.main(["horizon", "record", "--report", str(path), "--celex", PROPOSAL, "--stage", "proposal",
                     "--expected-date", "next spring"])
    assert code == 3 and "bad_date" in capsys.readouterr().err


def test_each_triage_is_a_langfuse_generation_inside_the_watch_trace():
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    from nutrivo_worker import observability as obs

    exporter = InMemorySpanExporter()
    obs.init_langfuse(Settings(langfuse_public_key="pk-lf-watch", langfuse_secret_key="sk-lf-watch"),
                      span_exporter=exporter)
    try:
        provider = ScriptedModel()
        with obs.run_observation("sources:watch", "run-7", {"request_id": "run-7"}):
            run(provider, max_items=2)
        obs.langfuse().flush()
        spans = exporter.get_finished_spans()
        root = next(s for s in spans if s.name == "sources:watch:run-7")
        gens = [s for s in spans if s.name == "triage"]
        assert len(gens) == len(provider.calls) == 2
        assert all(g.context.trace_id == root.context.trace_id for g in gens)
        assert {g.attributes["langfuse.observation.type"] for g in gens} == {"generation"}
    finally:
        obs.init_langfuse(Settings())
