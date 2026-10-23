"""T-207 (J01) on real Postgres: a person records horizon items from a watch report into ref.horizon_items.

Runs against the local Supabase database (`make verify-fast` starts it) or NUTRIVO_TEST_DATABASE_URL, and skips where
there is none. It uses test-only CELEX ids and deletes only the rows it created."""
import os
from datetime import date

import psycopg
import pytest
from fakes import FakeStore
from test_watch import PROPOSAL, ScriptedModel, answer, run

from nutrivo_worker.db import connect
from nutrivo_worker.sources import horizon

DSN = os.environ.get("NUTRIVO_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
TEST_PROPOSAL, TEST_ACT = "59999PC9999", "39999R9999"


@pytest.fixture
def conn():
    try:
        c = connect(DSN)
    except psycopg.OperationalError:
        pytest.skip("no local database; run make db-start")
    yield c
    c.execute("delete from ref.horizon_items where celex in (%s, %s)", (TEST_PROPOSAL, TEST_ACT))
    c.close()


def rows(conn, celex):
    return conn.execute("select * from ref.horizon_items where celex = %s", (celex,)).fetchall()


def test_J01_main_a_person_records_a_triaged_proposal_once(conn, tmp_path):
    report = run(ScriptedModel({PROPOSAL: answer("high", "A Commission proposal to amend 767/2009.")}), FakeStore())
    item = {**next(i for i in report.as_dict()["items"] if i["celex"] == PROPOSAL), "celex": TEST_PROPOSAL}
    rec = horizon.recording(item, "proposal", expected_date=date(2027, 6, 30), notes="watch run-1")
    store = horizon.PgHorizonStore(conn)
    status, item_id = store.record(rec)
    (row,) = rows(conn, TEST_PROPOSAL)
    assert status == "recorded" and str(row["id"]) == item_id
    assert (row["stage"], row["expected_date"], row["effective_from"]) == ("proposal", date(2027, 6, 30), None)
    assert row["title"].startswith("Proposal for a REGULATION") and row["notes"] == "watch run-1"
    assert store.record(rec) == ("unchanged", item_id) and len(rows(conn, TEST_PROPOSAL)) == 1
    assert TEST_PROPOSAL in store.known_celex()        # the next watch skips it


def test_J01_must_1_the_database_refuses_an_effective_date_on_a_proposal(conn):
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        conn.execute("insert into ref.horizon_items (title, stage, effective_from, celex) values (%s, %s, %s, %s)",
                     ("test", "proposal", date(2027, 1, 1), TEST_PROPOSAL))
    assert rows(conn, TEST_PROPOSAL) == []
    rec = horizon.recording({"celex": TEST_ACT, "kind": "legal_act", "title": "test act"}, "published",
                            effective_from=date(2027, 1, 1))
    assert horizon.PgHorizonStore(conn).record(rec)[0] == "recorded"
    assert rows(conn, TEST_ACT)[0]["effective_from"] == date(2027, 1, 1)
