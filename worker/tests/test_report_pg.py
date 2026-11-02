"""I01 on real Postgres and pgmq: a check runs, a report job is enqueued for one of its checks, runs through the job
loop, and the PDF, its model and the insert-only app.reports row are written. Then the reference is re-rendered a
year later, after everything mutable around it has changed, and gives the same bytes (BE-26).

Everything runs in one transaction that is rolled back (checks, findings and reports are insert-only, and the gate
tests assume an empty tenant dataset). Storage is the in-memory stand-in from test_export. The ruleset is
test_check_pg's synthetic one, never law."""
import io
import json
import time
import uuid

import psycopg
import pytest
from pgtest import DSN, skip_no_database
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pypdf import PdfReader
from test_check_pg import request_check, run_job, seed_product, seed_ruleset
from test_export import FakeStorage

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore
from nutrivo_worker.handlers import report as report_handler
from nutrivo_worker.jobs import Job, JobContext, Registry, process_message
from nutrivo_worker.reporting import model as m
from nutrivo_worker.reporting import service
from nutrivo_worker.reporting.store import PgReportStore

S = Settings(max_attempts=5, stale_after_s=900)
YEAR = 366 * 24 * 3600


@pytest.fixture
def conn():
    try:
        c = psycopg.connect(DSN, row_factory=dict_row, connect_timeout=10)   # not autocommit: rolled back below
    except psycopg.OperationalError:
        skip_no_database()
    if c.execute("select to_regnamespace('pgmq') is not null as ok").fetchone()["ok"] is False:
        c.close()
        skip_no_database("pgmq is not installed in this database")
    yield c
    c.rollback()
    c.close()


def one(conn, q, *a):
    return conn.execute(q, a).fetchone()


def checked(conn):
    """A product checked in EU-SE: the Swedish panel lacks the batch particular (one open finding)."""
    s = seed_product(conn, sv_texts=("Testfoder för katter",))
    seed_ruleset(conn, f"T405-{uuid.uuid4().hex[:6]}", s["person"], complete=False)
    check_job = request_check(conn, s)
    assert run_job(conn, check_job) == "succeeded"
    sv = one(conn, "select * from app.checks where job_id = %s and language = 'sv'", check_job)
    return s, sv


def enqueue_report(conn, s, check_id):
    """As the RPC will (private.enqueue under the requester's claims): ids only in the payload."""
    with conn.transaction():
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{s["user"]}","role":"authenticated"}}',))
        job_id = str(one(conn, "select private.enqueue('report', %s, %s, %s) as id", s["ws"],
                         f"report:{check_id}:{uuid.uuid4()}", Jsonb({"check_id": str(check_id),
                                                                     "request_id": "req-t405"}))["id"])
        conn.execute("select set_config('request.jwt.claims', '', true)")
    return job_id


def run_report(conn, job_id, storage):
    store = PgStore(conn)
    reg = Registry()
    reg.register("report")(lambda job, ctx: report_handler.run(job, ctx, storage=storage))
    msgs = [msg for msg in store.read("report", 30, 50) if msg.job_id == job_id]
    assert len(msgs) == 1 and msgs[0].body == {"job_id": job_id}
    return process_message(store, reg, msgs[0], S)


def text_of(pdf: bytes) -> str:
    return " ".join(" ".join((p.extract_text() or "").split()) for p in PdfReader(io.BytesIO(pdf)).pages)


def test_I01_main_generate_a_report_end_to_end(conn):
    """[I01.main] A report job for a check renders the PDF, stores it and its model under the workspace, writes the
    insert-only app.reports row pinned to the ruleset and artwork hash, audits it, and a member reads it under RLS.
    A second run of the job writes nothing and prints no second reference."""
    s, sv = checked(conn)
    storage = FakeStorage()
    job_id = enqueue_report(conn, s, sv["id"])
    assert run_report(conn, job_id, storage) == "succeeded"

    rep = one(conn, "select * from app.reports where job_id = %s", job_id)
    assert rep["check_ids"] == [sv["id"]] and rep["node_id"] == "EU-SE"
    assert (rep["ruleset_version"], rep["artwork_sha"]) == (sv["ruleset_version"], sv["artwork_sha"])
    assert rep["has_not_assessed"] is True                      # the claims domain is partial: section 05 lists it
    assert str(rep["created_by"]) == s["person"] and len(rep["ref"]) == 26
    assert rep["pdf_path"] == f'{s["ws"]}/{s["product"]}/{rep["ref"]}.pdf'
    pdf = storage.objects[("reports", rep["pdf_path"])]
    assert service.sha256(pdf) == rep["pdf_sha256"]
    doc = json.loads(storage.objects[("reports", rep["pdf_path"].replace(".pdf", ".json"))])
    assert doc["ref"] == rep["ref"] and doc["issued_at"] == m.iso(rep["created_at"])

    text = text_of(pdf)
    assert rep["ref"] in text and sv["ruleset_version"] in text and "What was not assessed" in text
    assert sv["artwork_sha"] in text.replace(" ", "") and m.iso(rep["created_at"]) in text
    face = text.lower()
    assert "gap-eu-se-claims_wording" in face.replace(" ", "") and "synthetic test rule" in face
    assert "test cat food" in face

    progress = one(conn, "select status, progress from app.jobs where id = %s", job_id)
    assert progress["status"] == "succeeded"
    p = progress["progress"]
    assert (p["outcome"], p["ref"], p["report_id"], p["sha256"]) == ("generated", rep["ref"], str(rep["id"]),
                                                                      rep["pdf_sha256"])
    assert "url" not in json.dumps(p).lower()
    audit = one(conn, "select ruleset_version, after from app.audit_events where kind = 'report.generated'"
                      " and object_id = %s", str(rep["id"]))
    assert audit["ruleset_version"] == sv["ruleset_version"] and audit["after"]["ref"] == rep["ref"]

    # Idempotent: the job run again (a retry after a lost acknowledgement) writes nothing more.
    jrow = one(conn, "select kind, workspace_id, payload from app.jobs where id = %s", job_id)
    job = Job(job_id, "report", str(jrow["workspace_id"]), jrow["payload"], 2)
    again = report_handler.run(job, JobContext(job, PgStore(conn), S), storage=storage)
    assert again["outcome"] == "already_generated" and again["ref"] == rep["ref"]
    assert one(conn, "select count(*) as n from app.reports where check_ids = %s", [sv["id"]])["n"] == 1

    # A member reads the row under RLS; the public verification knows the reference.
    with conn.transaction():
        conn.execute("select set_config('request.jwt.claims', %s, true)",
                     (f'{{"sub":"{s["user"]}","role":"authenticated"}}',))
        conn.execute("set local role authenticated")
        assert one(conn, "select ref from app.reports where id = %s", rep["id"])["ref"] == rep["ref"]
        conn.execute("reset role")
    v = one(conn, "select public.verify_reference(%s) as v", rep["ref"])["v"]
    assert (v["status"], v["ruleset_version"], v["has_not_assessed"]) == ("current", sv["ruleset_version"], True)


def test_I01_main_retry_after_a_crash_keeps_the_reference(conn):
    """[I01.main] The reference is minted once per job: a run that died after storing the model and the PDF but
    before the row is retried with the same reference, finds the stored files and writes one row."""
    s, sv = checked(conn)
    storage = FakeStorage()
    job_id = enqueue_report(conn, s, sv["id"])
    store = PgReportStore(conn)
    conn.execute("update app.jobs set status = 'running' where id = %s", (job_id,))
    ctx = JobContext(Job(job_id, "report", s["ws"], {"check_id": str(sv["id"])}, 1), PgStore(conn), S)

    class Crash(Exception):
        pass

    def crash(*a, **kw):
        raise Crash

    original, store.insert = store.insert, crash
    with pytest.raises(Crash):
        service.generate(store, storage, job_id=job_id, workspace_id=s["ws"], check_id=str(sv["id"]),
                         heartbeat=ctx.heartbeat)
    ref = one(conn, "select progress from app.jobs where id = %s", job_id)["progress"]["ref"]
    store.insert = original
    one(conn, "update app.products set name = 'Renamed between attempts' where id = %s returning id", s["product"])
    result = service.generate(store, storage, job_id=job_id, workspace_id=s["ws"], check_id=str(sv["id"]),
                              heartbeat=ctx.heartbeat)
    assert result.outcome == "generated" and result.ref == ref
    assert "Renamed between attempts" not in text_of(storage.objects[("reports", result.pdf_path)])
    assert len([k for k in storage.objects if k[1].endswith(".pdf")]) == 1


def test_I01_main_a_check_of_another_workspace_is_refused(conn):
    """[I01.main] The job's workspace must be the check's: nothing is rendered or written otherwise."""
    s, sv = checked(conn)
    other = one(conn, "insert into app.workspaces (name, created_by) values ('Other', %s) returning id",
                s["person"])["id"]
    job_id = str(one(conn, "select private.enqueue('report', %s, %s, %s) as id", other, f"report:x:{uuid.uuid4()}",
                     Jsonb({"check_id": str(sv["id"])}))["id"])
    storage = FakeStorage()
    assert run_report(conn, job_id, storage) == "failed"
    assert storage.objects == {}
    assert one(conn, "select count(*) as n from app.reports where job_id = %s", job_id)["n"] == 0


def test_I01_must_1_the_same_reference_rerendered_a_year_later_is_the_same_document(conn, monkeypatch):
    """[I01.must.1] Generate, then change everything mutable around the report (product name, requester name,
    registration state, rule title, gap description), move the clock a year on and re-render by reference: the same
    bytes, hashing to app.reports.pdf_sha256, and the check events still match the stored model (BE-26)."""
    s, sv = checked(conn)
    storage = FakeStorage()
    job_id = enqueue_report(conn, s, sv["id"])
    assert run_report(conn, job_id, storage) == "succeeded"
    rep = one(conn, "select * from app.reports where job_id = %s", job_id)
    issued = storage.objects[("reports", rep["pdf_path"])]

    conn.execute("update app.products set name = 'Renamed product' where id = %s", (s["product"],))
    conn.execute("update app.people set display_name = 'Renamed person' where id = %s", (s["person"],))
    conn.execute("update app.product_nodes set registration_state = 'registered' where product_id = %s",
                 (s["product"],))
    conn.execute("update ref.rules set title = 'Retitled rule' where rule_key like 'TEST.T403.%%'")
    conn.execute("update ref.coverage_gaps set description = 'Redescribed gap' where gap_id = 'GAP-EU-SE-CLAIMS_WORDING'")
    later = time.time() + YEAR
    monkeypatch.setattr(time, "time", lambda: later)

    again = service.rerender(PgReportStore(conn), storage, rep["ref"])
    assert again.identical and again.pinned_match
    assert again.pdf == issued and again.sha256 == rep["pdf_sha256"]
    face = text_of(again.pdf).lower()
    assert "renamed product" not in face and "test cat food" in face


def test_I01_must_1_a_tampered_model_does_not_reproduce(conn):
    """[I01.must.1] A stored model edited after issue neither matches the check events nor the issued hash."""
    s, sv = checked(conn)
    storage = FakeStorage()
    job_id = enqueue_report(conn, s, sv["id"])
    assert run_report(conn, job_id, storage) == "succeeded"
    rep = one(conn, "select * from app.reports where job_id = %s", job_id)
    key = ("reports", rep["pdf_path"].replace(".pdf", ".json"))
    doc = json.loads(storage.objects[key])
    doc["pinned"]["findings"][0]["message"] = "Nothing to see here."
    storage.objects[key] = m.dumps(doc)
    again = service.rerender(PgReportStore(conn), storage, rep["ref"])
    assert not again.identical and not again.pinned_match
    with pytest.raises(service.ReportNotFound):
        service.rerender(PgReportStore(conn), storage, "Z" * 26)
