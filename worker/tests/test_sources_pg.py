"""T-201 on real Postgres: ref.sources gets one row per distinct body, under an advisory lock; storage is faked.

Runs against the local Supabase database (`make verify-fast` starts it) or NUTRIVO_TEST_DATABASE_URL, and skips where
there is none (the CI worker job until T-009). It deletes only the rows it created."""
import dataclasses
import os
from datetime import UTC, datetime

import psycopg
import pytest
from test_sources import client

from nutrivo_worker.db import connect
from nutrivo_worker.sources import eurlex
from nutrivo_worker.sources.store import Meta, PgSourceStore, StorageError

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
NOW = datetime(2026, 10, 23, 3, 30, tzinfo=UTC)
CELEX = "09999R9999-20181226"     # a test-only id, so rows a real run left in the local database never collide
META = Meta(title="Regulation (EC) No 767/2009 · consolidated text 2018-12-26 [test:t201]")


class FakeStorage:
    def __init__(self, fail=False):
        self.puts, self.fail = [], fail

    def put(self, bucket, path, body, content_type):
        if self.fail:
            raise StorageError("storage upload to sources answered HTTP 500")
        self.puts.append((bucket, path))


@pytest.fixture
def conn():
    try:
        c = connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database (the CI worker job has none until T-009); run make db-start")
    yield c
    c.execute("delete from ref.sources where celex = %s", (CELEX,))
    c.close()


@pytest.fixture(scope="module")
def doc():
    return dataclasses.replace(eurlex.fetch(client(), "02009R0767-20181226", "da"), celex=CELEX)


def rows(conn):
    return conn.execute("select * from ref.sources where celex = %s", (CELEX,)).fetchall()


def test_ref_sources_row_carries_hash_language_celex_date_and_url(conn, doc):
    storage = FakeStorage()
    status, source_id = PgSourceStore(conn, storage).save(doc, META, NOW)
    (row,) = rows(conn)
    assert status == "stored" and str(row["id"]) == source_id
    assert (row["kind"], row["celex"], row["language"], row["licence"]) == (
        "eurlex", CELEX, "da", "eu_reuse")
    assert eurlex.consolidation_date(row["celex"]).isoformat() == "2018-12-26"
    assert row["sha256"] == doc.sha256 and row["url"] == doc.url and row["retrieved_at"] == NOW
    assert storage.puts == [("sources", row["storage_path"])]
    assert row["storage_path"] == f"eurlex/{CELEX}/da/{doc.sha256}.xhtml"


def test_same_hash_again_adds_no_row_and_uploads_nothing(conn, doc):
    storage = FakeStorage()
    store = PgSourceStore(conn, storage)
    first = store.save(doc, META, NOW)
    second = store.save(doc, META, NOW)
    assert first[0] == "stored" and second == ("unchanged", first[1])
    assert len(rows(conn)) == 1 and len(storage.puts) == 1


def test_failed_upload_leaves_no_row(conn, doc):
    with pytest.raises(StorageError):
        PgSourceStore(conn, FakeStorage(fail=True)).save(doc, META, NOW)
    assert rows(conn) == []
