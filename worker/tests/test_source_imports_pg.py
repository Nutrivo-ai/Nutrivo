"""T-202 on real Postgres: register pulls in ref.sources, ref.feed_additives and ref.feed_materials upserts, and the
all-or-nothing transaction. Storage is faked.

Runs against the local Supabase database (`make verify-fast` starts it) or NUTRIVO_TEST_DATABASE_URL, and skips where
there is none. It deletes only the rows it created (test-only ids and urls)."""
import hashlib
import os
from contextlib import suppress
from datetime import UTC, date, datetime

import psycopg
import pytest
from test_source_imports import REC_REGISTER, client
from test_sources_pg import FakeStorage

from nutrivo_worker.db import connect
from nutrivo_worker.sources import register
from nutrivo_worker.sources.catalogue import MaterialRow, PgMaterialTable
from nutrivo_worker.sources.register import AdditiveRow, PgAdditiveTable, Pull
from nutrivo_worker.sources.store import Meta, PgSourceStore

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
NOW = datetime(2026, 10, 23, 8, 0, tzinfo=UTC)
URL = "https://register.invalid/t202/policy-items"
ID = "test:t202:9z901"
NUMBER = "99.99.99"           # not a catalogue number


@pytest.fixture
def conn():
    try:
        c = connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database (the CI worker job has none until T-009); run make db-start")
    yield c
    c.execute("delete from ref.feed_additives where id like 'test:t202:%'")
    c.execute("delete from ref.feed_materials where number = %s", (NUMBER,))
    c.execute("delete from ref.sources where url like 'https://register.invalid/t202/%'")
    c.close()


def pull(body=b'[{"test": "t202"}]'):
    return Pull("feed-additives", "policy-items", URL, None, "application/json", body,
                hashlib.sha256(body).hexdigest())


def source_id(conn):
    _, sid = PgSourceStore(conn, FakeStorage()).save_pull(pull(), Meta("[test:t202]"), NOW)
    return sid


def test_register_pull_row_carries_kind_url_hash_path_and_date(conn):
    storage = FakeStorage()
    p = pull()
    status, sid = PgSourceStore(conn, storage).save_pull(p, Meta("[test:t202]"), NOW)
    row = conn.execute("select * from ref.sources where id = %s", (sid,)).fetchone()
    assert status == "stored"
    assert (row["kind"], row["url"], row["sha256"], row["licence"], row["retrieved_at"], row["celex"]) == (
        "register", URL, p.sha256, "eu_reuse", NOW, None)
    assert row["storage_path"] == f"register/feed-additives/policy-items/{p.sha256}.json"
    assert storage.puts == [("sources", row["storage_path"])]


def test_same_register_pull_again_adds_no_row_and_uploads_nothing(conn):
    first = source_id(conn)
    storage = FakeStorage()
    assert PgSourceStore(conn, storage).save_pull(pull(), Meta("[test:t202]"), NOW) == ("unchanged", first)
    assert storage.puts == []


def test_additive_upsert_inserts_then_is_unchanged_then_updates(conn):
    table, sid = PgAdditiveTable(conn), source_id(conn)
    row = AdditiveRow(ID, "Test additive", "Group one", ["Cats; Dogs"], "Act one", date(2030, 1, 1))
    assert table.upsert(row, sid) is True
    assert table.upsert(row, sid) is False
    assert table.upsert(AdditiveRow(**{**row.__dict__, "species": ["Cats; Dogs", "Horses"]}), sid) is True
    got = conn.execute("select * from ref.feed_additives where id = %s", (ID,)).fetchone()
    assert (got["species"], got["expiry"], str(got["source_id"])) == (["Cats; Dogs", "Horses"], date(2030, 1, 1), sid)
    assert ID in table.ids()


def test_additive_upsert_never_touches_max_content_conditions_or_category(conn):
    table, sid = PgAdditiveTable(conn), source_id(conn)
    conn.execute("""insert into ref.feed_additives (id, name, category, max_content, conditions)
                    values (%s, 'Earlier', 'kept', '{"kept": 1}', '{"kept": 2}')""", (ID,))
    table.upsert(AdditiveRow(ID, "Test additive", None, [], None, None), sid)
    got = conn.execute("select * from ref.feed_additives where id = %s", (ID,)).fetchone()
    assert (got["name"], got["category"], got["max_content"], got["conditions"]) == (
        "Test additive", "kept", {"kept": 1}, {"kept": 2})


def test_material_upsert_writes_names_per_language_and_declarations(conn):
    table, sid = PgMaterialTable(conn), source_id(conn)
    row = MaterialRow(NUMBER, {"en": "Name", "sv": "Namn"}, "Desc", ["A", "B"])
    assert table.upsert(row, sid) is True
    assert table.upsert(row, sid) is False
    got = conn.execute("select * from ref.feed_materials where number = %s", (NUMBER,)).fetchone()
    assert (got["names"], got["description"], got["compulsory_declarations"]) == (
        {"en": "Name", "sv": "Namn"}, "Desc", ["A", "B"])


class FailingTable(PgAdditiveTable):
    def __init__(self, conn, after):
        super().__init__(conn)
        self.after = after

    def upsert(self, row, source_id):
        self.after -= 1
        if self.after < 0:
            raise RuntimeError("database went away")
        return super().upsert(row, source_id)


def test_register_import_that_fails_part_way_writes_nothing(conn):
    def counts():
        return (conn.execute("select count(*) as n from ref.feed_additives").fetchone()["n"],
                conn.execute("select count(*) as n from ref.sources where kind = 'register'").fetchone()["n"])

    before = counts()
    outcomes = register.run(client(REC_REGISTER), PgSourceStore(conn, FakeStorage()), FailingTable(conn, 10),
                            transaction=conn.transaction, now=lambda: NOW)
    assert [o.status for o in outcomes] == ["failed"]
    assert counts() == before
    with suppress(Exception):
        conn.rollback()


def test_material_numbers_are_read_back(conn):
    PgMaterialTable(conn).upsert(MaterialRow(NUMBER, {"en": "Name"}, None, []), source_id(conn))
    assert NUMBER in PgMaterialTable(conn).numbers()
