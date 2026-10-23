"""T-203 · K01/K02 dual extraction over stored sources, with a scripted fake model (no real model is ever called).

The source body is the recorded T-201 English consolidated text of Reg. 767/2009; the fake answers quote it, so the
verbatim checks run against real stored text. Nothing here is regulatory content: it is test data."""
import contextlib
import gzip
import hashlib
import json
import re
from pathlib import Path

import pytest
from fakes import FakeProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from nutrivo_worker import observability as obs
from nutrivo_worker.config import WORKER_ROOT, Settings
from nutrivo_worker.content import extract, targets
from nutrivo_worker.content.extract import Candidate, SourceRow
from nutrivo_worker.content.store import PgCandidateStore
from nutrivo_worker.models import Models

TESTS = Path(__file__).parent
EN_767 = gzip.decompress((TESTS / "recordings" / "eurlex" / "c1df7a69bdf2de16.body.gz").read_bytes())
SHA = hashlib.sha256(EN_767).hexdigest()
ACT = "32009R0767"

BATCH = targets.Target("EU.767.BATCH", "mandatory_particular", "mandatory_particulars",
                       "Reg. 767/2009, Art. 15(d) (batch or lot reference number)", None, ACT, ("Art. 15",))
MOISTURE = targets.Target("EU.767.MOISTURE", "threshold", "composition",
                          "Reg. 767/2009, Art. 15(g) with Annex I point 6 (moisture content declaration)",
                          "The moisture level above which declaration is required", ACT, ("Art. 15", "Annex I"))


def answer(found=True, ref="Art. 15(d)", excerpt="the batch or lot reference number;", params=None):
    if params is None and found:
        params = {"particular": "the batch or lot reference number", "conditions": []}
    return {"found": found, "article_ref": ref if found else "", "excerpt": excerpt if found else "",
            "abstain_reason": None if found else "not in the units", "params": params}


MOISTURE_14 = answer(ref="Annex I point 6", excerpt="14 % in the case of other feed.", params={
    "quantity": "moisture content", "operator": "gt", "value": 14, "value_text": "14 %", "unit": "%",
    "then": "the moisture content of the feed must be stated"})


class Scripted(FakeProvider):
    """Answers by model id (eu.extract = first key, eu.judge = second key) and the target key in the input."""

    def __init__(self, answers, **kw):
        super().__init__(**kw)
        self.answers = answers

    def complete(self, model_id, system, user, schema, max_tokens):
        key = re.search(r'"key":"([^"]+)"', user).group(1)
        self.text = json.dumps(self.answers[(model_id, key)])
        return super().complete(model_id, system, user, schema, max_tokens)


class Reader:
    def __init__(self, rows=None, body=EN_767):
        self.rows = rows if rows is not None else [row()]
        self.body_bytes, self.reads = body, 0

    def sources(self, act, languages):
        return [r for r in self.rows if languages is None or r.language in languages]

    def body(self, r):
        self.reads += 1
        return self.body_bytes


def row(**kw):
    base = {"id": "src-en", "kind": "eurlex", "celex": "02009R0767-20181226", "language": "en",
            "title": "Regulation (EC) No 767/2009 · consolidated text", "url": "https://publications.europa.eu/x",
            "sha256": SHA, "storage_path": f"eurlex/02009R0767-20181226/en/{SHA}.xhtml"}
    return SourceRow(**{**base, **kw})


class Store:
    """ref.rule_candidates in memory, with the same write limits as PgCandidateStore."""

    def __init__(self):
        self.rows, self.model_calls, self.locks = {}, [], []

    @contextlib.contextmanager
    def locked(self, source_id, rule_key):
        self.locks.append((source_id, rule_key))
        yield

    def find(self, source_id, rule_key):
        r = self.rows.get((source_id, rule_key))
        return Candidate(r["id"], r["first_value"], r["second_value"], r["decision"]) if r else None

    def insert_first(self, source_id, rule_key, article, source_ref, first_value):
        rid = f"cand-{len(self.rows) + 1}"
        self.rows[(source_id, rule_key)] = {"id": rid, "source_id": source_id, "proposed_rule_key": rule_key,
                                            "article": article, "source_ref": source_ref, "first_value": first_value,
                                            "second_value": None, "agree": None, "decision": "pending"}
        return rid

    def set_second(self, candidate_id, second_value, agree, decision):
        if decision not in extract.OPEN_DECISIONS:
            raise ValueError(decision)
        r = next(r for r in self.rows.values() if r["id"] == candidate_id)
        if r["second_value"] is not None or r["decision"] not in extract.OPEN_DECISIONS:
            return False
        r.update(second_value=second_value, agree=agree, decision=decision)
        return True

    def insert_model_call(self, r):
        self.model_calls.append(r)


def models(tmp_path, answers, **kw):
    provider = Scripted(answers, **kw)
    return Models(Settings(models_mode="live", cassette_dir=tmp_path / "cassettes"), [provider]), provider


def test_K01_main_first_extraction_from_the_stored_text_writes_a_candidate_with_article_and_verbatim_excerpt(
        tmp_path):
    m, _ = models(tmp_path, {("eu.extract", BATCH.key): answer(),
                             ("eu.judge", BATCH.key): answer(ref="Art. 15 (d)")})
    store = Store()
    (res,) = extract.run([BATCH], Reader(), store, m)
    assert res.status == "stored" and res.agree is True and res.decision == "pending"
    cand = store.rows[("src-en", BATCH.key)]
    assert cand["article"] == "Art. 15" and cand["source_ref"] == "02009R0767-20181226 en Art. 15(d)"
    first = cand["first_value"]
    assert first["extraction"]["excerpt"] == "the batch or lot reference number;" and first["verified"] is True
    assert first["source_sha256"] == SHA and first["prompt_version"] == "extraction_primary.v1"
    assert first["model_id"] == "eu.extract" and first["units"] == ["Art. 15"]
    # One app.model_calls row per call, with the prompt file that produced it.
    assert [c["prompt_version"] for c in store.model_calls] == ["extraction_primary.v1", "extraction_secondary.v1"]
    assert store.locks == [("src-en", BATCH.key)]


def test_K01_must_1_never_from_memory_FEDIAF_and_AAFCO_are_never_sources(tmp_path):
    m, provider = models(tmp_path, {("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer()})
    refused = {
        "source_refused": row(id="fediaf", title="FEDIAF Nutritional Guidelines"),
        "source_kind_refused": row(id="guide", kind="guidance"),
        "source_not_stored": row(id="unstored", sha256=None),
        "source_act_mismatch": row(id="other-act", celex="02002L0032-20191128"),
    }
    for reason, r in refused.items():
        (res,) = extract.run([BATCH], Reader([r]), Store(), m)
        assert (res.status, res.reason) == ("failed", reason)
    aafco = row(id="aafco", url="https://www.aafco.org/model-bill")
    assert extract.run([BATCH], Reader([aafco]), Store(), m)[0].reason == "source_refused"
    # A body that is not the stored one (its sha256 differs) is never read as the source.
    (res,) = extract.run([BATCH], Reader(body=EN_767 + b" "), Store(), m)
    assert (res.status, res.reason) == ("failed", "source_hash_mismatch")
    assert provider.calls == []                       # refused before any model saw anything
    # A target pointing at an industry code, or at an act not in content/sources.yaml, is never extracted.
    fediaf_target = targets.Target("X.FEDIAF", "threshold", "composition", "FEDIAF guidelines, table 3", None,
                                   None, ())
    assert extract.run([fediaf_target], Reader(), Store(), m)[0].reason == "source_refused"
    listed = targets.load_targets(WORKER_ROOT.parent / "content" / "candidates" / "eu-core.yaml", set())
    assert all(t.skip_reason in ("act_not_resolved", *targets.NOT_EXTRACTED.values()) for t in listed)
    # The model sees the stored units only, and a value the stored text does not print is withheld, never stored.
    invented = answer(excerpt="the batch number and the date of manufacture")
    m2, provider2 = models(tmp_path, {("eu.extract", BATCH.key): invented, ("eu.judge", BATCH.key): answer()})
    store = Store()
    (res,) = extract.run([BATCH], Reader(), store, m2)
    assert (res.status, res.reason) == ("withheld", "excerpt_not_in_source") and store.rows == {}
    user = provider2.calls[0]["user"]
    assert "[Art. 15]\nArticle 15" in user and "Article 16" not in user and "[Annex" not in user
    translated = answer(params={"particular": "partinummer", "conditions": []})
    m3, _ = models(tmp_path, {("eu.extract", BATCH.key): translated, ("eu.judge", BATCH.key): answer()})
    assert extract.run([BATCH], Reader(), Store(), m3)[0].reason == "excerpt_not_in_source"


def test_K02_main_second_extraction_is_independent_and_agreement_is_computed_field_by_field(tmp_path):
    second = {**MOISTURE_14, "excerpt": "10 % in the case of mineral feed containing organic substances,",
              "params": {**MOISTURE_14["params"], "value": 10, "value_text": "10 %"}}
    m, provider = models(tmp_path, {("eu.extract", MOISTURE.key): MOISTURE_14, ("eu.judge", MOISTURE.key): second})
    store = Store()
    (res,) = extract.run([MOISTURE], Reader(), store, m)
    assert res.status == "stored" and res.agree is False and res.decision == "needs_review"
    assert res.disagreements == ["params.value", "params.value_text"]
    first_call, second_call = provider.calls
    # Independent: a different model class and prompt, the same stored units, and never the first answer.
    assert (first_call["model_id"], second_call["model_id"]) == ("eu.extract", "eu.judge")
    assert first_call["system"] != second_call["system"]
    assert "[Annex I]" in second_call["user"] and second_call["user"] == first_call["user"]
    cand = store.rows[("src-en", MOISTURE.key)]
    assert cand["article"] == "Annex I" and cand["agree"] is False
    fields = cand["second_value"]["fields"]
    assert fields["params.value"] is False and fields["params.operator"] is True and fields["article_ref"] is True
    assert cand["second_value"]["prompt_version"] == "extraction_secondary.v1"
    # An abstaining second key disagrees on `found` and goes to a person.
    m2, _ = models(tmp_path, {("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer(found=False)})
    (res,) = extract.run([BATCH], Reader(), Store(), m2)
    assert (res.agree, res.decision) == (False, "needs_review") and "found" in res.disagreements


def test_K02_must_1_nothing_reaches_the_rules_on_extraction_alone(tmp_path):
    m, _ = models(tmp_path, {("eu.extract", MOISTURE.key): MOISTURE_14, ("eu.judge", MOISTURE.key): MOISTURE_14,
                             ("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer()})
    store = Store()
    results = extract.run([MOISTURE, BATCH], Reader(), store, m)
    # Full agreement still leaves a candidate for a person: thresholds always to review, never accepted.
    assert {r.target: (r.agree, r.decision) for r in results} == {
        MOISTURE.key: (True, "needs_review"), BATCH.key: (True, "pending")}
    assert all(r["decision"] in ("pending", "needs_review") for r in store.rows.values())
    with pytest.raises(ValueError):
        PgCandidateStore(conn=None).set_second("cand-1", {}, True, "accepted")
    # The extraction code writes candidates only: its one insert and one update are on ref.rule_candidates (never
    # ref.rules, ref.rule_versions or a ruleset), and nothing sets a person's decision.
    src = WORKER_ROOT / "src" / "nutrivo_worker" / "content"
    code = "\n".join(p.read_text() for p in src.glob("*.py"))
    assert re.findall(r"(?i)(?:insert\s+into|update|delete\s+from|truncate)\s+(ref\.\w+|app\.\w+)", code) == [
        "ref.rule_candidates", "ref.rule_candidates"]
    for forbidden in ("decided_by", "decided_at", "'accepted'", '"accepted"'):
        assert forbidden not in code, forbidden


def test_a_rerun_is_unchanged_and_a_failed_second_key_resumes_there(tmp_path):
    answers = {("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer()}
    m, provider = models(tmp_path, answers, fail=0)
    store = Store()
    # The second key's provider is down: the first value is kept, the pair fails visibly.
    m.providers[0].models = {"extraction": "eu.extract"}
    (res,) = extract.run([BATCH], Reader(), store, m)
    assert (res.status, res.reason) == ("failed", "model_unavailable")
    cand = store.rows[("src-en", BATCH.key)]
    assert cand["first_value"] and cand["second_value"] is None and cand["agree"] is None
    # Next run: only the second key is called.
    m.providers[0].models = {"extraction": "eu.extract", "judgement": "eu.judge"}
    provider.calls.clear()
    (res,) = extract.run([BATCH], Reader(), store, m)
    assert res.status == "updated" and res.agree is True and [c["model_id"] for c in provider.calls] == ["eu.judge"]
    # And again: nothing to do, no model call, no read of the body.
    provider.calls.clear()
    reader = Reader()
    (res,) = extract.run([BATCH], reader, store, m)
    assert res.status == "unchanged" and provider.calls == [] and reader.reads == 0
    # A decided candidate is never touched.
    cand["decision"], cand["second_value"] = "rejected", None
    assert extract.run([BATCH], Reader(), store, m)[0].status == "unchanged" and provider.calls == []


def test_every_pair_ends_in_a_visible_state(tmp_path):
    m, _ = models(tmp_path, {("eu.extract", BATCH.key): answer(found=False)})
    claims = targets.Target("EU.767.CLAIMS_GENERAL", "claim_judgement", "claims_wording", "Reg. 767/2009, Art. 11(1)",
                            None, ACT, ("Art. 11",))
    missing_unit = targets.Target("EU.767.NOPE", "mandatory_particular", "x", "Reg. 767/2009, Art. 99", None, ACT,
                                  ("Art. 99",))
    results = extract.run([claims, BATCH, missing_unit], Reader(), Store(), m)
    assert [(r.status, r.reason) for r in results] == [
        ("skipped", "needs_claims_harness"), ("withheld", "not_found"), ("withheld", "units_not_in_source")]
    assert extract.run([BATCH], Reader(rows=[]), Store(), m)[0].reason == "source_not_stored"
    # Dry run: both keys, compared, nothing written.
    m2, _ = models(tmp_path, {("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer()})
    (res,) = extract.run([BATCH], Reader(), None, m2)
    assert (res.status, res.agree) == ("extracted", True)


def test_each_target_and_source_is_one_langfuse_trace_with_a_generation_per_model_call(tmp_path):
    exporter = InMemorySpanExporter()
    obs.init_langfuse(Settings(langfuse_public_key="pk-lf-content", langfuse_secret_key="sk-lf-content"),
                      span_exporter=exporter)
    try:
        m, _ = models(tmp_path, {("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer()})
        extract.run([BATCH], Reader(), Store(), m)
        obs.langfuse().flush()
        spans = exporter.get_finished_spans()
        trace = next(s for s in spans if s.name == f"content:extract:{BATCH.key}:src-en")
        gens = [s for s in spans if s.name in (extract.PRIMARY, extract.SECONDARY)]
        assert len(gens) == 2 and all(g.context.trace_id == trace.context.trace_id for g in gens)
        assert all(g.attributes["langfuse.observation.type"] == "generation" for g in gens)
        assert {g.attributes["langfuse.observation.model.name"] for g in gens} == {"eu.extract", "eu.judge"}
    finally:
        obs.init_langfuse(Settings())


def test_compare_ignores_case_whitespace_and_list_order_but_not_values():
    a = {"found": True, "article_ref": "Art. 15(d)", "params": {"particular": "The  batch", "conditions": ["x", "y"]}}
    b = {"found": True, "article_ref": "art 15 (d)", "params": {"particular": "the batch", "conditions": ["y", "x"]}}
    assert all(extract.compare(a, b).values())
    c = {**b, "params": {"particular": "the lot", "conditions": ["y", "x"]}}
    assert extract.compare(a, c) == {"article_ref": True, "found": True, "params.conditions": True,
                                     "params.particular": False}
