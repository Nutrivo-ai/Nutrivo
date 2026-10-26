"""O03 export on real Postgres and pgmq: a job enqueued as the RPC enqueues it, run through the job loop.

Everything runs in one transaction that is rolled back, because the seeded checks and reports are insert-only and the
gate tests assume an empty tenant dataset. Storage is an in-memory stand-in (tests/test_export.py covers its use)."""
import io
import json
import uuid
import zipfile

import psycopg
import pytest
from pgtest import DSN, skip_no_database
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from test_export import FakeStorage

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore
from nutrivo_worker.handlers import export
from nutrivo_worker.jobs import Job, JobContext, Registry, process_message

S = Settings(max_attempts=5, stale_after_s=900)
RULESET = "0000.00-empty"


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


def seed(conn, *, plan="free", status="active", subscription=None):
    """One workspace with a recipe, a product in a market, a withheld check and finding, a report and a document."""
    one = lambda q, *a: conn.execute(q, a).fetchone()["id"]
    person = one("insert into app.people (display_name) values ('Test admin') returning id")
    ws = one("insert into app.workspaces (name, plan, status, created_by) values ('T-804', %s, %s, %s) returning id",
             plan, status, person)
    if subscription:
        conn.execute("insert into app.subscriptions (workspace_id, plan, status) values (%s, %s, %s)",
                     (ws, plan, subscription))
    family = one("insert into app.families (workspace_id, name) values (%s, 'Adult') returning id", ws)
    product = one("insert into app.products (workspace_id, family_id, name, stage) values (%s, %s, 'Adult chicken',"
                  " 'active') returning id", ws, family)
    conn.execute("insert into app.product_nodes (product_id, node_id, workspace_id, ruleset_version)"
                 " values (%s, 'EU-DE', %s, %s)", (product, ws, RULESET))
    check = one("insert into app.checks (workspace_id, product_id, node_id, language, ruleset_version, label_state,"
                " withheld_rule_keys) values (%s, %s, 'EU-DE', 'de', %s, 'not_assessed', '{k.one}') returning id",
                ws, product, RULESET)
    conn.execute("insert into app.check_findings (workspace_id, check_id, product_id, node_id, state, provenance,"
                 " reason_code, message, rule_key) values (%s, %s, %s, 'EU-DE', 'not_assessed', 'not_assessed',"
                 " 'no_true_scale', 'withheld', 'k.one')", (ws, check, product))
    report = one("insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version,"
                 " artwork_sha, has_not_assessed, pdf_path) values (%s, %s, 'EU-DE', %s, array[%s]::uuid[], %s,"
                 " 'abc', true, %s) returning id",
                 ws, product, uuid.uuid4().hex, check, RULESET, f"{ws}/report.pdf")
    doc = one("insert into app.supplier_documents (workspace_id, product_id, doc_type, storage_path, file_sha256,"
              " uploaded_via, scan_status) values (%s, %s, 'spec', %s, 'def', 'member', 'clean') returning id",
              ws, product, f"{ws}/spec.pdf")
    return {"ws": str(ws), "family": str(family), "product": str(product), "check": str(check),
            "report": str(report), "doc": str(doc)}


def storage_for(*seeded):
    objects = {}
    for s in seeded:
        objects[("reports", f"{s['ws']}/report.pdf")] = f"report {s['ws']}".encode()
        objects[("documents", f"{s['ws']}/spec.pdf")] = f"spec {s['ws']}".encode()
    return FakeStorage(objects)


def unzip(body):
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def test_O03_main_export_everything_runs_through_the_job_loop_and_reads_only_its_workspace(conn):
    mine, theirs = seed(conn), seed(conn)
    storage = storage_for(mine, theirs)
    key = f"test:t804:{uuid.uuid4()}"
    job_id = str(conn.execute("select private.enqueue('export', %s, %s, %s) as id",
                              (mine["ws"], key, Jsonb({"request_id": "req-o03"}))).fetchone()["id"])
    store = PgStore(conn)
    reg = Registry()
    reg.register("export")(lambda j, ctx: export.run(j, ctx, storage=storage))
    msgs = [m for m in store.read("export", 30, 10) if m.job_id == job_id]
    assert len(msgs) == 1 and msgs[0].body == {"job_id": job_id}            # the message holds the id only

    assert process_message(store, reg, msgs[0], S) == "succeeded"

    row = conn.execute("select status, progress, payload from app.jobs where id = %s", (job_id,)).fetchone()
    path = f"{mine['ws']}/{job_id}.zip"
    assert row["status"] == "succeeded"
    assert row["progress"]["stage"] == "ready" and row["progress"]["path"] == path
    assert "url" not in json.dumps(row["progress"]).lower() and set(row["payload"]) == {"request_id"}

    files = unzip(storage.objects[("exports", path)])
    everything = b"".join(files.values()).decode()
    for value in mine.values():
        assert value in everything
    for key_, value in theirs.items():
        assert value not in everything, f"another workspace's {key_} leaked into the export"
    assert files[f"reports/{mine['report']}.pdf"] == f"report {mine['ws']}".encode()
    assert files[f"documents/{mine['doc']}.pdf"] == f"spec {mine['ws']}".encode()
    for name in ("checks.csv", "findings.csv", "reports.csv", "product_markets.csv"):
        lines = files[name].decode().splitlines()
        assert lines[0].split(",")[-1] == "ruleset_version" and lines[1].endswith("," + RULESET), name
    for name in ("recipes.csv", "documents.csv", "certificates.csv"):
        assert files[name].decode().splitlines()[0].split(",")[-1] == "ruleset_version", name
    manifest = json.loads(files["manifest.json"])
    assert manifest["request_id"] == "req-o03" and manifest["files_missing"] == []


@pytest.mark.parametrize("plan, status, subscription", [
    ("free", "active", None),
    ("basic", "dunning", "past_due"),
    ("standard", "new_artwork_stopped", "unpaid"),
    ("advanced", "dormant", "canceled"),
    ("free", "closed", "canceled"),
])
def test_O03_must_1_export_is_free_on_every_plan_and_never_gated(conn, plan, status, subscription):
    s = seed(conn, plan=plan, status=status, subscription=subscription)
    job = Job(str(uuid.uuid4()), "export", s["ws"], {}, 1)
    storage = storage_for(s)
    progress: list[dict] = []
    ctx = JobContext(job, PgStore(conn), S)
    ctx.heartbeat = lambda **p: progress.append(p)   # type: ignore[method-assign]
    result = export.run(job, ctx, storage=storage)
    assert result["path"] == f"{s['ws']}/{job.id}.zip" and progress[-1]["stage"] == "ready"
    files = unzip(storage.objects[("exports", result["path"])])
    assert s["check"] in files["checks.csv"].decode() and s["family"] in files["recipes.csv"].decode()
