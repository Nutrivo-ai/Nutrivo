"""T-201: the EUR-Lex source fetcher, offline against responses recorded from the live services
(tests/recordings/eurlex/README.md). Nothing here reaches the network."""
import gzip
import hashlib
import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from nutrivo_worker import cli
from nutrivo_worker.sources import eurlex
from nutrivo_worker.sources.eurlex import Consolidation, Document
from nutrivo_worker.sources.fetch import Act, load_sources, run
from nutrivo_worker.sources.http import (
    USER_AGENT,
    PoliteClient,
    ReplayTransport,
    Response,
    SourceBlocked,
    SourceError,
    TransportError,
)
from nutrivo_worker.sources.store import StorageClient, StorageError, storage_path

REC = Path(__file__).parent / "recordings" / "eurlex"
SOURCES = Path(__file__).resolve().parents[2] / "content" / "sources.yaml"
LANGS = ["en", "sv", "da", "fi", "de"]
ACT_767 = Act("32009R0767", "Regulation (EC) No 767/2009 on the placing on the market and use of feed")
TODAY = date(2026, 10, 23)
NOW = datetime(2026, 10, 23, 3, 30, tzinfo=UTC)


def client(transport=None, **kw):
    return PoliteClient(transport or ReplayTransport(REC), min_interval_s=0.0, sleep=lambda s: None, **kw)


def recorded_bodies():
    """sha256 of every recorded 200 manifestation body, by URL."""
    out = {}
    for meta_path in REC.glob("*.json"):
        meta = json.loads(meta_path.read_text())
        if meta["status"] == 200 and "/resource/cellar/" in meta["url"]:
            body = gzip.decompress(meta_path.with_suffix("").with_suffix(".body.gz").read_bytes())
            out[meta["url"]] = hashlib.sha256(body).hexdigest()
    return out


class FakeStore:
    """ref.sources semantics in memory: one row per (celex, language, sha256)."""

    def __init__(self):
        self.rows, self.objects = {}, {}

    def save(self, doc, meta, retrieved_at):
        key = (doc.celex, doc.language, doc.sha256)
        if key in self.rows:
            return "unchanged", self.rows[key]["id"]
        self.objects[storage_path(doc)] = doc.body
        self.rows[key] = {"id": f"row-{len(self.rows) + 1}", "title": meta.title, "licence": meta.licence,
                          "url": doc.url, "retrieved_at": retrieved_at}
        return "stored", self.rows[key]["id"]


def test_sources_file_lists_the_launch_languages_and_valid_acts():
    acts, languages, licence = load_sources(SOURCES)
    assert languages == LANGS
    assert licence == "eu_reuse"
    assert ACT_767.celex in [a.celex for a in acts]


def test_latest_consolidated_text_in_five_languages_stored_with_sha256():
    store = FakeStore()
    results = run([ACT_767], LANGS, client(), store, today=TODAY, now=lambda: NOW)
    bodies = recorded_bodies()
    assert [r.language for r in results] == LANGS
    for r in results:
        assert r.status == "stored", r
        assert r.celex == "02009R0767-20181226"
        assert r.consolidated_on == "2018-12-26"
        assert r.url.startswith("https://publications.europa.eu/resource/cellar/")
        assert r.sha256 == bodies[r.url]                    # the bytes as served, hashed
    assert len({r.sha256 for r in results}) == 5
    row = store.rows[("02009R0767-20181226", "sv", results[1].sha256)]
    assert row["licence"] == "eu_reuse" and row["retrieved_at"] == NOW
    assert "consolidated text 2018-12-26" in row["title"]
    for path, body in store.objects.items():
        assert path.startswith("eurlex/02009R0767-20181226/")
        assert path.endswith(hashlib.sha256(body).hexdigest() + ".xhtml")


def test_same_hash_twice_is_unchanged_and_adds_no_row():
    store = FakeStore()
    first = run([ACT_767], LANGS, client(), store, today=TODAY, now=lambda: NOW)
    second = run([ACT_767], LANGS, client(), store, today=TODAY, now=lambda: NOW)
    assert {r.status for r in first} == {"stored"}
    assert {r.status for r in second} == {"unchanged"}
    assert [r.source_id for r in first] == [r.source_id for r in second]
    assert len(store.rows) == 5


def test_dry_run_hashes_and_writes_nothing():
    results = run([ACT_767], ["fi"], client(), None, today=TODAY)
    assert [r.status for r in results] == ["fetched"]
    assert results[0].source_id is None


def test_act_without_consolidated_version_is_fetched_as_published_and_says_so():
    results = run([Act("32017R2279", "Reg. 2017/2279")], ["en"], client(), FakeStore(), today=TODAY)
    (r,) = results
    assert r.status == "stored" and r.celex == "32017R2279" and r.consolidated_on is None
    assert "no consolidated version" in r.note


def test_consolidations_ahead_of_today_are_reported_not_fetched():
    versions = [Consolidation("02009R0767-20180101", date(2018, 1, 1)),
                Consolidation("02009R0767-20181226", date(2018, 12, 26)),
                Consolidation("02009R0767-20270101", date(2027, 1, 1))]
    current, later = eurlex.pick(versions, TODAY)
    assert current.celex == "02009R0767-20181226"
    assert [v.celex for v in later] == ["02009R0767-20270101"]
    assert eurlex.pick(versions[2:], TODAY) == (None, versions[2:])


def test_consolidation_date_is_read_from_the_consolidated_celex():
    assert eurlex.consolidation_date("02009R0767-20181226") == date(2018, 12, 26)
    assert eurlex.consolidation_date("01976L0211-20190726") == date(2019, 7, 26)
    assert eurlex.consolidation_date("32009R0767") is None


@pytest.mark.parametrize("bad", ['32009R0767") } DROP', "02009R0767-20181226", "", "R0767"])
def test_only_act_celex_ids_reach_the_sparql_query(bad):
    with pytest.raises(SourceError) as e:
        eurlex.consolidations(client(), bad)
    assert e.value.reason == "bad_celex"


def test_waf_bot_challenge_fails_as_source_blocked_without_retry():
    replay = ReplayTransport(REC)
    c = client(replay)
    with pytest.raises(SourceBlocked) as e:
        c.get("https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02009R0767-20181226",
              {"Accept": "application/xhtml+xml", "Accept-Language": "eng"})
    assert e.value.reason == "source_blocked"
    assert c.requests_sent == 1


def test_missing_language_version_fails_as_not_available():
    with pytest.raises(SourceError) as e:
        eurlex.fetch(client(), "02017R2279-20171214", "en")
    assert e.value.reason == "not_available"


class SwapLanguage:
    """Answers a request for one language with the recorded body of another."""

    def __init__(self, asked, served):
        self.inner, self.asked, self.served = ReplayTransport(REC), asked, served

    def send(self, method, url, headers, body=None):
        h = dict(headers)
        if h.get("Accept-Language") == self.asked:
            h["Accept-Language"] = self.served
        return self.inner.send(method, url, h, body)


def test_body_in_another_language_fails_and_is_not_stored():
    store = FakeStore()
    results = run([ACT_767], ["en"], client(SwapLanguage("eng", "swe")), store, today=TODAY)
    assert [(r.status, r.reason) for r in results] == [("failed", "language_mismatch")]
    assert store.rows == {}


def test_detect_language_on_each_recorded_manifestation():
    for lang in LANGS:
        doc = eurlex.fetch(client(), "02009R0767-20181226", lang)
        assert eurlex.detect_language(doc.body) == lang


class Scripted:
    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def send(self, method, url, headers, body=None):
        self.calls.append((url, dict(headers)))
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def ok(body=b"{}"):
    return Response(200, {"content-type": "application/json"}, body, "u")


def test_retries_are_bounded_with_backoff_and_honour_retry_after():
    sleeps = []
    t = Scripted(TransportError("URLError"), Response(503, {"retry-after": "30"}, b"", "u"), ok())
    c = PoliteClient(t, min_interval_s=0.0, backoff_base_s=5, sleep=sleeps.append)
    assert c.get("https://publications.europa.eu/x").status == 200
    assert sleeps == [5, 30]                       # 5 s backoff, then Retry-After over the 10 s backoff
    t = Scripted(*[Response(503, {}, b"", "u")] * 4)
    c = PoliteClient(t, min_interval_s=0.0, max_attempts=4, sleep=lambda s: None)
    with pytest.raises(SourceError) as e:
        c.get("https://publications.europa.eu/x")
    assert e.value.reason == "retries_exhausted" and len(t.calls) == 4


def test_requests_are_rate_limited_and_identify_the_fetcher():
    clock = [0.0]
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock[0] += s

    t = Scripted(ok(), ok(), ok())
    c = PoliteClient(t, min_interval_s=2.0, sleep=sleep, clock=lambda: clock[0])
    for _ in range(3):
        c.get("https://publications.europa.eu/x")
        clock[0] += 0.5
    assert sleeps == [1.5, 1.5]
    assert all(h["User-Agent"] == USER_AGENT for _, h in t.calls)


def test_redirects_to_plain_http_are_followed_over_https():
    t = Scripted(Response(303, {"location": "http://publications.europa.eu/resource/cellar/a/DOC_1"}, b"", "u"), ok())
    resp = PoliteClient(t, min_interval_s=0.0).get("https://publications.europa.eu/resource/celex/1")
    assert t.calls[1][0] == "https://publications.europa.eu/resource/cellar/a/DOC_1"
    assert resp.status == 200


def test_every_failure_is_a_visible_result_and_the_run_goes_on():
    t = Scripted(Response(500, {}, b"", "u"), Response(500, {}, b"", "u"))
    results = run([Act("32005R0183", "Reg. 183/2005"), ACT_767], ["en"],
                  PoliteClient(_Chain(t, ReplayTransport(REC)), min_interval_s=0.0, max_attempts=2,
                               sleep=lambda s: None), FakeStore(), today=TODAY)
    assert [(r.act, r.status, r.reason) for r in results] == [
        ("32005R0183", "failed", "retries_exhausted"), ("32009R0767", "stored", None)]


class _Chain:
    """Scripted answers first, then the recordings."""

    def __init__(self, first, then):
        self.first, self.then = first, then

    def send(self, method, url, headers, body=None):
        if self.first.answers:
            return self.first.send(method, url, headers, body)
        return self.then.send(method, url, headers, body)


def test_storage_upload_is_idempotent_and_errors_are_safe():
    doc = Document("02009R0767-20181226", date(2018, 12, 26), "en", "https://x", "application/xhtml+xml", b"<a/>",
                   hashlib.sha256(b"<a/>").hexdigest())
    t = Scripted(Response(200, {}, b"{}", "u"),
                 Response(400, {}, b'{"statusCode":"409","error":"Duplicate","message":"exists"}', "u"),
                 Response(500, {}, b"internal detail", "u"))
    s = StorageClient("http://127.0.0.1:54321/", "test-key", transport=t)
    s.put("sources", storage_path(doc), doc.body, doc.content_type)
    s.put("sources", storage_path(doc), doc.body, doc.content_type)
    with pytest.raises(StorageError) as e:
        s.put("sources", storage_path(doc), doc.body, doc.content_type)
    assert "internal detail" not in str(e.value)
    url, headers = t.calls[0]
    assert url == f"http://127.0.0.1:54321/storage/v1/object/sources/eurlex/02009R0767-20181226/en/{doc.sha256}.xhtml"
    assert headers["x-upsert"] == "false" and headers["Content-Type"] == "application/xhtml+xml"


def test_cli_dry_run_from_recordings(capsys):
    code = cli.main(["sources", "fetch", "--dry-run", "--celex", "32009R0767", "--replay", str(REC)])
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    results = [d for d in lines if "act" in d and "status" in d]
    assert code == 0
    assert [d["status"] for d in results] == ["fetched"] * 5
    assert {"summary": {"fetched": 5}, "requests": 11} in lines


def test_cli_exits_non_zero_when_a_document_fails(capsys):
    code = cli.main(["sources", "fetch", "--dry-run", "--celex", "32005R0183", "--lang", "en", "--replay", str(REC)])
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    results = [d for d in lines if "act" in d and "status" in d]
    assert code == 1
    assert [(d["act"], d["language"], d["status"], d["reason"]) for d in results] == [
        ("32005R0183", "en", "failed", "recording_missing")]
    assert {"summary": {"failed": 1}, "requests": 1} in lines


def test_cli_store_mode_needs_storage_settings(monkeypatch, capsys):
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://127.0.0.1:1/none")
    assert cli.main(["sources", "fetch", "--celex", "32009R0767", "--replay", str(REC)]) == 2
    assert "SUPABASE_SERVICE_ROLE_KEY" in capsys.readouterr().err
