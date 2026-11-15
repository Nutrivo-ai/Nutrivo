"""K01/K02 for terms: candidate ref.term_entries from each stored language version, written only when two independent
keys read the same printed string (docs/12). A scripted fake model answers; no real model is ever called.

The body is the recorded T-201 English consolidated text of Reg. 767/2009, so the verbatim checks run against real
stored text. Nothing here is regulatory content: it is test data."""
import contextlib
import json
import os
import re

import psycopg
import pytest
from fakes import FakeProvider
from test_content_extract import EN_767, SHA, Reader, row

from nutrivo_worker.config import WORKER_ROOT, Settings
from nutrivo_worker.content import articles, terms
from nutrivo_worker.content.store import PgSourceReader, PgTermStore
from nutrivo_worker.db import connect
from nutrivo_worker.models import Models
from nutrivo_worker.sources.fetch import load_sources

ACT = "32009R0767"
TYPE_OF_FEED = terms.TermGroup(
    "EU.767.TERMS.TYPE_OF_FEED", "prescribed_designation", "Reg. 767/2009, Art. 15(a)", ACT, ("Art. 15",),
    (terms.TermSpec("complete_feed", "the designation for complete feed"),
     terms.TermSpec("complementary_feed", "the designation for complementary feed")))
LINE = "the type of feed: ‘feed material’, ‘complete feed’ or ‘complementary feed’, as appropriate;"


def ans(key, term, excerpt=LINE, ref="Art. 15(a)", found=True):
    return {"key": key, "found": found, "term": term if found else "", "article_ref": ref if found else "",
            "excerpt": excerpt if found else ""}


BOTH = [ans("complete_feed", "complete feed"), ans("complementary_feed", "complementary feed")]


class Scripted(FakeProvider):
    """Answers by model id (eu.extract = first key, eu.judge = second key) and the group key in the input."""

    def __init__(self, answers, **kw):
        super().__init__(**kw)
        self.answers = answers

    def complete(self, model_id, system, user, schema, max_tokens):
        group = re.search(r'"key":"([^"]+)"', user).group(1)
        self.text = json.dumps({"answers": self.answers[(model_id, group)]})
        return super().complete(model_id, system, user, schema, max_tokens)


def models(tmp_path, first, second, group=TYPE_OF_FEED.group):
    provider = Scripted({("eu.extract", group): first, ("eu.judge", group): second})
    return Models(Settings(models_mode="live", cassette_dir=tmp_path / "cassettes"), [provider]), provider


class Store:
    """ref.term_entries in memory, with PgTermStore's limits: insert a candidate, never update."""

    def __init__(self, existing=None):
        self.rows = dict(existing or {})          # (source_id, language, term_key) → row
        self.model_calls, self.locks = [], []

    @contextlib.contextmanager
    def locked(self, source_id, group):
        self.locks.append((source_id, group))
        yield

    def existing(self, source_id, language, term_keys):
        return {k: (r["id"], r["status"]) for (s, lang, k), r in self.rows.items()
                if s == source_id and lang == language and k in term_keys}

    def insert(self, term_key, language, term, kind, article_ref, source_id):
        rid = f"term-{len(self.rows) + 1}"
        self.rows[(source_id, language, term_key)] = {"id": rid, "term": term, "kind": kind, "status": "candidate",
                                                      "article_ref": article_ref}
        return rid

    def insert_model_call(self, r):
        self.model_calls.append(r)


def test_terms_main_two_keys_reading_the_same_printed_term_write_a_candidate_entry(tmp_path):
    m, provider = models(tmp_path, BOTH, BOTH)
    store = Store()
    results = terms.run([TYPE_OF_FEED], Reader(), store, m)
    assert [(r.term_key, r.status, r.language) for r in results] == [
        ("complete_feed", "stored", "en"), ("complementary_feed", "stored", "en")]
    entry = store.rows[("src-en", "en", "complete_feed")]
    assert (entry["term"], entry["kind"], entry["status"], entry["article_ref"]) == (
        "complete feed", "prescribed_designation", "candidate", "Art. 15(a)")
    # Two independent keys: different model classes and prompts, the same stored units, never the first answer.
    assert [c["prompt_version"] for c in store.model_calls] == ["term_extraction_primary.v1",
                                                                "term_extraction_secondary.v1"]
    first_user, second_user = provider.calls[0]["user"], provider.calls[1]["user"]
    assert first_user == second_user and "Article 15" in first_user and "Article 16" not in first_user
    assert provider.calls[0]["system"] != provider.calls[1]["system"]   # the prompts differ
    assert [c["model_id"] for c in provider.calls] == ["eu.extract", "eu.judge"]


@pytest.mark.parametrize("first,second,reason", [
    # Neither key's excerpt is printed in the stored text, however its quotes are styled.
    ([ans("complete_feed", "complete feed", excerpt="the kind of feed: 'complete feed'")],
     [ans("complete_feed", "complete feed", excerpt="type: complete feed")], "excerpt_not_in_source"),
    # A term with straight quotes where the text prints ‘ ’ is not the printed term.
    ([ans("complete_feed", "'complete feed'")], BOTH, "excerpt_not_in_source"),
    # A term that is not inside its own excerpt (here a translation).
    ([ans("complete_feed", "Alleinfuttermittel")], BOTH, "excerpt_not_in_source"),
    (BOTH, [ans("complete_feed", "complete fodder")], "second_not_verbatim"),
    ([ans("complete_feed", "complete feed", ref="")], BOTH, "excerpt_not_in_source"),
    # A part of a printed word is not the printed term, even when both keys read it ('fee' in 'feed').
    ([ans("complete_feed", "complete fee")], [ans("complete_feed", "complete fee")], "excerpt_not_in_source"),
    # Nor is a string running across two printed lines (here the end of point (a) and the dash below it).
    ([ans("complete_feed", "as appropriate; —", excerpt=LINE + " —")],
     [ans("complete_feed", "as appropriate; —", excerpt=LINE + " —")], "excerpt_not_in_source"),
    (BOTH, [ans("complete_feed", "feed material")], "keys_disagree"),
    (BOTH, [ans("complete_feed", "", found=False)], "keys_disagree"),
    ([ans("complete_feed", "", found=False)], [ans("complete_feed", "", found=False)], "not_found"),
    ([], [], "not_found"),                                               # a key that is never answered
])
def test_terms_anything_but_two_verbatim_identical_reads_is_withheld_and_writes_nothing(tmp_path, first, second,
                                                                                       reason):
    group = terms.TermGroup(TYPE_OF_FEED.group, TYPE_OF_FEED.kind, TYPE_OF_FEED.candidate_source, ACT, ("Art. 15",),
                            (TYPE_OF_FEED.terms[0],))
    m, _ = models(tmp_path, first, second)
    store = Store()
    (res,) = terms.run([group], Reader(), store, m)
    assert (res.status, res.reason) == ("withheld", reason) and store.rows == {}


def test_terms_a_disagreement_shows_both_printed_terms_for_the_operator(tmp_path):
    m, _ = models(tmp_path, BOTH, [ans("complete_feed", "feed material"), BOTH[1]])
    results = terms.run([TYPE_OF_FEED], Reader(), Store(), m)
    assert results[0].as_dict()["first"] == "complete feed" and results[0].as_dict()["second"] == "feed material"
    assert results[1].status == "stored"


def test_terms_whitespace_differences_agree_and_the_term_is_stored_normalised(tmp_path):
    m, _ = models(tmp_path, [ans("complete_feed", "complete  feed")], [ans("complete_feed", "complete feed\n")])
    group = terms.TermGroup(TYPE_OF_FEED.group, TYPE_OF_FEED.kind, "Reg. 767/2009, Art. 15(a)", ACT, ("Art. 15",),
                            (TYPE_OF_FEED.terms[0],))
    store = Store()
    (res,) = terms.run([group], Reader(), store, m)
    assert res.status == "stored" and store.rows[("src-en", "en", "complete_feed")]["term"] == "complete feed"


def test_terms_rerun_is_unchanged_with_no_model_call_and_a_rejected_entry_is_never_proposed_again(tmp_path):
    existing = {("src-en", "en", "complete_feed"): {"id": "t1", "status": "rejected"},
                ("src-en", "en", "complementary_feed"): {"id": "t2", "status": "accepted"}}
    m, provider = models(tmp_path, BOTH, BOTH)
    store = Store(existing)
    results = terms.run([TYPE_OF_FEED], Reader(), store, m)
    assert [(r.status, r.reason) for r in results] == [("unchanged", "already_rejected"),
                                                       ("unchanged", "already_accepted")]
    assert provider.calls == [] and store.rows == existing
    # Only the missing key is asked for and written; the existing one is left alone.
    store = Store({("src-en", "en", "complete_feed"): {"id": "t1", "status": "candidate"}})
    results = terms.run([TYPE_OF_FEED], Reader(), store, m)
    assert [(r.term_key, r.status) for r in results] == [("complete_feed", "unchanged"),
                                                        ("complementary_feed", "stored")]
    assert '"complete_feed"' not in provider.calls[0]["user"]


def test_terms_never_from_memory_FEDIAF_and_AAFCO_are_never_sources_and_a_changed_body_is_refused(tmp_path):
    m, provider = models(tmp_path, BOTH, BOTH)
    (res,) = terms.run([TYPE_OF_FEED], Reader([row(title="FEDIAF Nutritional Guidelines")]), Store(), m)
    assert (res.status, res.reason) == ("failed", "source_refused")
    (res,) = terms.run([TYPE_OF_FEED], Reader(body=EN_767 + b" "), Store(), m)
    assert (res.status, res.reason) == ("failed", "source_hash_mismatch")
    assert provider.calls == []
    group = terms.TermGroup("G", "heading", "Reg. 767/2009, Annex XX", ACT, ("Annex XX",), TYPE_OF_FEED.terms)
    assert {(r.status, r.reason) for r in terms.run([group], Reader(), Store(), m)} == {
        ("withheld", "units_not_in_source")}
    fediaf = terms.TermGroup("G", "heading", "FEDIAF guidelines", None, (), TYPE_OF_FEED.terms)
    assert [(r.status, r.reason) for r in terms.run([fediaf], Reader(), Store(), m)] == [("skipped", "source_refused")]


def test_terms_dry_run_extracts_and_writes_nothing(tmp_path):
    m, _ = models(tmp_path, BOTH, BOTH)
    assert {r.status for r in terms.run([TYPE_OF_FEED], Reader(), None, m)} == {"extracted"}


def test_the_term_groups_file_resolves_to_listed_acts_and_units_with_unique_keys():
    acts, _, _ = load_sources(WORKER_ROOT.parent / "content" / "sources.yaml")
    groups = {g.group: g for g in terms.load_groups(WORKER_ROOT.parent / "content" / "candidates" /
                                                    "eu-core-terms.yaml", {a.celex for a in acts})}
    assert all(g.skip_reason is None and g.act == ACT for g in groups.values())
    assert groups["EU.767.TERMS.TYPE_OF_FEED"].units == ("Art. 15",)
    assert groups["EU.767.TERMS.HEADING_COMPOSITION"].units == ("Art. 17",)
    assert groups["EU.767.TERMS.ANALYTICAL_CONSTITUENTS"].units == ("Annex VII",)
    keys = [t.key for g in groups.values() for t in g.terms]
    assert len(keys) == len(set(keys)) and {"complete_feed", "heading_composition"} <= set(keys)


def test_a_malformed_term_groups_file_stops_the_run(tmp_path):
    p = tmp_path / "g.yaml"
    head = "groups: [{group: G, candidate_source: 'Reg. 767/2009, Art. 15', "
    for bad in ("kind: nonsense, terms: [{key: a, find: x}]}]",
                "kind: heading, terms: [{key: Bad-Key, find: x}]}]",
                "kind: heading, terms: [{key: a, find: x}, {key: a, find: y}]}]"):
        p.write_text(head + bad)
        with pytest.raises(terms.TargetError):
            terms.load_groups(p, {ACT})


# ── on real Postgres ────────────────────────────────────────────────────────────────────────────────
DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
CELEX = "09999R9767-20181226"          # a test-only id, never one a real fetch stores


class Storage:
    def get(self, bucket, path):
        return EN_767


@pytest.fixture
def conn():
    try:
        c = connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database; run make db-start")
    (sid,) = [r["id"] for r in c.execute(
        """insert into ref.sources (kind, celex, title, url, language, licence, retrieved_at, sha256, storage_path)
           values ('eurlex', %(celex)s, 'test:terms', 'https://publications.europa.eu/x', 'en', 'eu_reuse', now(),
                   %(sha)s, 'eurlex/' || %(celex)s || '/en/' || %(sha)s || '.xhtml') returning id""",
        {"celex": CELEX, "sha": SHA}).fetchall()]
    yield c, sid
    c.execute("delete from ref.term_entries where source_id = %s", (sid,))
    c.execute("delete from ref.sources where id = %s", (sid,))
    c.close()


def test_term_candidates_on_postgres_are_candidates_only_and_idempotent(conn, tmp_path):
    c, sid = conn
    group = terms.TermGroup(TYPE_OF_FEED.group, TYPE_OF_FEED.kind, TYPE_OF_FEED.candidate_source, "39999R9767",
                            ("Art. 15",), TYPE_OF_FEED.terms)
    m, provider = models(tmp_path, BOTH, BOTH)
    reader, store = PgSourceReader(c, Storage()), PgTermStore(c)
    assert {r.status for r in terms.run([group], reader, store, m, languages=["en"])} == {"stored"}
    rows = c.execute("""select term_key, language, term, kind, article_ref, status, ruleset_version
                          from ref.term_entries where source_id = %s order by term_key""", (sid,)).fetchall()
    assert [(r["term_key"], r["term"], r["status"], r["ruleset_version"]) for r in rows] == [
        ("complementary_feed", "complementary feed", "candidate", None),
        ("complete_feed", "complete feed", "candidate", None)]
    assert not c.execute("select 1 from ref.term_decisions d join ref.term_entries t on t.id = d.term_entry_id"
                         " where t.source_id = %s", (sid,)).fetchall()
    provider.calls.clear()
    assert {r.status for r in terms.run([group], reader, store, m, languages=["en"])} == {"unchanged"}
    assert provider.calls == []


def test_terms_an_excerpt_with_straight_quotes_still_locates_the_printed_passage_and_the_printed_term_is_kept(
        tmp_path):
    straight = LINE.replace("‘", "'").replace("’", "'")
    m, _ = models(tmp_path, [ans("complete_feed", "complete feed", excerpt=straight)], [ans("complete_feed",
                                                                                           "complete feed")])
    group = terms.TermGroup(TYPE_OF_FEED.group, TYPE_OF_FEED.kind, TYPE_OF_FEED.candidate_source, ACT, ("Art. 15",),
                            (TYPE_OF_FEED.terms[0],))
    store = Store()
    (res,) = terms.run([group], Reader(), store, m)
    assert res.status == "stored" and store.rows[("src-en", "en", "complete_feed")]["term"] == "complete feed"


def test_locate_returns_the_printed_passage_up_to_whitespace_quote_and_dash_style_only():
    printed = "die Futtermittelart: „Einzelfuttermittel“, „Alleinfuttermittel“ —\n oder x"
    assert articles.locate(printed, 'Futtermittelart: "Einzelfuttermittel",  "Alleinfuttermittel" -') == (
        "Futtermittelart: „Einzelfuttermittel“, „Alleinfuttermittel“ —")
    assert articles.locate(printed, "Futtermittelart: Einzelfuttermittel") is None   # a missing quote is a change
    assert articles.locate(printed, "futtermittelart") is None                       # case is never folded
    assert articles.locate(printed, "  ") is None and articles.locate(printed, "a.b") is None
    assert articles.locate("café", "caf`e") is None                                 # an accent is not a quote


def test_printed_as_words_needs_whole_words():
    assert articles.printed_as_words("— Crude fibres", "Crude fibres")
    assert not articles.printed_as_words("— Crude fibres", "Crude fibre")
    assert not articles.printed_as_words("— Crude fibres", "rude fibres") and not articles.printed_as_words("x", " ")


def test_terms_one_keys_excerpt_locating_the_term_is_enough_when_both_read_the_same_printed_term(tmp_path):
    # In a table the first key may join lines from different cells; the second key's excerpt locates the term.
    m, _ = models(tmp_path, [ans("complete_feed", "complete feed", excerpt="as appropriate; complete feed")],
                  [ans("complete_feed", "complete feed")])
    group = terms.TermGroup(TYPE_OF_FEED.group, TYPE_OF_FEED.kind, TYPE_OF_FEED.candidate_source, ACT, ("Art. 15",),
                            (TYPE_OF_FEED.terms[0],))
    store = Store()
    (res,) = terms.run([group], Reader(), store, m)
    assert res.status == "stored" and store.rows[("src-en", "en", "complete_feed")]["term"] == "complete feed"


def test_terms_a_trailing_ellipsis_is_dropped_so_the_term_is_the_printed_words_a_label_carries(tmp_path):
    line = "‘best before …’ followed by the date indicating a certain month in the case of other feed."
    group = terms.TermGroup("EU.767.TERMS.MINIMUM_STORAGE_LIFE", "prescribed_designation", "Reg. 767/2009, Art. 17",
                            ACT, ("Art. 17",), (terms.TermSpec("best_before", "the wording for other feed"),))
    m, _ = models(tmp_path, [ans("best_before", "best before …", excerpt=line, ref="Art. 17(1)(d)")],
                  [ans("best_before", "best before", excerpt=line, ref="Art. 17(1)(d)")], group=group.group)
    store = Store()
    (res,) = terms.run([group], Reader(), store, m)
    assert res.status == "stored" and store.rows[("src-en", "en", "best_before")]["term"] == "best before"
