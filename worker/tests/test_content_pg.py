"""T-203 on real Postgres: ref.rule_candidates written by the K01/K02 run, idempotent, never past `needs_review`.

Runs against the local Supabase database (`make verify-fast` starts it) or NUTRIVO_TEST_DATABASE_URL, and skips where
there is none. Storage is faked (the body is the recorded T-201 text); the model is the scripted fake. It deletes only
the rows it created; app.model_calls is insert-only, so its rows stay."""
import os

import psycopg
import pytest
from test_content_extract import BATCH, EN_767, MOISTURE, MOISTURE_14, SHA, answer, models

from nutrivo_worker.content import extract
from nutrivo_worker.content.store import PgCandidateStore, PgSourceReader
from nutrivo_worker.db import connect

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
CELEX = "09999R9767-20181226"          # a test-only id, never one a real fetch stores
ACT = "39999R9767"


class Storage:
    def __init__(self):
        self.paths = []

    def get(self, bucket, path):
        self.paths.append((bucket, path))
        return EN_767


@pytest.fixture
def conn():
    try:
        c = connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database; run make db-start")
    ids = [r["id"] for r in c.execute(
        """insert into ref.sources (kind, celex, title, url, language, licence, retrieved_at, sha256, storage_path)
           select 'eurlex', %(celex)s, 'test:t203', 'https://publications.europa.eu/x', l, 'eu_reuse', now(),
                   %(sha)s, 'eurlex/' || %(celex)s || '/' || l || '/' || %(sha)s || '.xhtml'
             from unnest(array['en', 'da']) l returning id""", {"celex": CELEX, "sha": SHA}).fetchall()]
    yield c
    c.execute("delete from ref.rule_candidates where source_id = any(%s)", (ids,))
    c.execute("delete from ref.sources where celex = %s", (CELEX,))
    c.close()


def test_candidates_on_postgres_are_idempotent_and_never_past_needs_review(conn, tmp_path):
    targets_ = [extract_target(BATCH), extract_target(MOISTURE)]
    m, provider = models(tmp_path, {("eu.extract", BATCH.key): answer(), ("eu.judge", BATCH.key): answer(),
                                    ("eu.extract", MOISTURE.key): MOISTURE_14, ("eu.judge", MOISTURE.key): MOISTURE_14})
    storage = Storage()
    reader, store = PgSourceReader(conn, storage), PgCandidateStore(conn)
    results = extract.run(targets_, reader, store, m, languages=["en"])
    assert [(r.target, r.status, r.language) for r in results] == [
        (BATCH.key, "stored", "en"), (MOISTURE.key, "stored", "en")]
    assert storage.paths[0] == ("sources", f"eurlex/{CELEX}/en/{SHA}.xhtml")
    rows = conn.execute("""select c.proposed_rule_key, c.article, c.source_ref, c.agree, c.decision,
                                  c.first_value ->> 'source_sha256' sha, c.second_value -> 'fields' fields
                             from ref.rule_candidates c join ref.sources s on s.id = c.source_id
                            where s.celex = %s order by 1""", (CELEX,)).fetchall()
    assert [(r["proposed_rule_key"], r["article"], r["agree"], r["decision"], r["sha"]) for r in rows] == [
        (BATCH.key, "Art. 15", True, "pending", SHA), (MOISTURE.key, "Annex I", True, "needs_review", SHA)]
    assert rows[0]["source_ref"] == f"{CELEX} en Art. 15(d)" and rows[0]["fields"]["params.particular"] is True
    calls = conn.execute("select prompt_version from app.model_calls where model_id in ('eu.extract', 'eu.judge')"
                         " and created_at > now() - interval '10 minutes'").fetchall()
    assert {c["prompt_version"] for c in calls} >= {"extraction_primary.v1", "extraction_secondary.v1"}
    # A rerun changes nothing and calls no model.
    provider.calls.clear()
    assert {r.status for r in extract.run(targets_, reader, store, m, languages=["en"])} == {"unchanged"}
    assert provider.calls == []
    # A decided candidate keeps its decision: set_second only writes undecided rows without a second value.
    cid = str(conn.execute("select c.id from ref.rule_candidates c join ref.sources s on s.id = c.source_id"
                           " where s.celex = %s and proposed_rule_key = %s", (CELEX, BATCH.key)).fetchone()["id"])
    conn.execute("update ref.rule_candidates set decision = 'rejected', second_value = null where id = %s", (cid,))
    assert store.set_second(cid, {}, True, "pending") is False
    assert conn.execute("select decision from ref.rule_candidates where id = %s", (cid,)).fetchone()["decision"] \
        == "rejected"


def test_the_reader_returns_the_latest_stored_text_per_language(conn):
    rows = PgSourceReader(conn, Storage()).sources(ACT, None)
    assert sorted(r.language for r in rows) == ["da", "en"] and {r.celex for r in rows} == {CELEX}
    assert [r.language for r in PgSourceReader(conn, Storage()).sources(ACT, ["da"])] == ["da"]


def extract_target(t):
    import dataclasses

    return dataclasses.replace(t, act=ACT)
