"""T-303: the `extract` job on real Postgres (and, for the main path, local Supabase Storage).

Artworks are registered the way the web registers them: app.register_artwork under an editor's JWT claims, which
enqueues the extract job. Every test makes its own workspace, so nothing depends on another test's rows; insert-only
audit rows stay behind by design. CI's `worker` job starts the stack and fails these tests rather than skip them."""
import hashlib
import json
import os
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pgtest import DSN, connect_or_skip, skip_no_database, skip_no_service
from pydantic import SecretStr

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import extract as h
from nutrivo_worker.jobs import Job, JobContext, Registry, Worker, registry
from nutrivo_worker.sources.http import TransportError
from nutrivo_worker.sources.store import StorageClient

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "fixtures" / "synth" / "out"
S = Settings(max_attempts=5, stale_after_s=900, poll_interval_s=0.05, heartbeat_every_s=3600, reap_every_s=3600)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

pytestmark = pytest.mark.skipif(not (SYNTH / "mixed_9panels.pdf").exists(), reason="no local fixtures: run make fixtures")


@pytest.fixture
def conn():
    c = connect_or_skip(connect)
    if c.execute("select to_regnamespace('pgmq') is not null as ok").fetchone()["ok"] is False:
        skip_no_database("pgmq is not installed in this database")
    c.execute("select pgmq.purge_queue('extract')")
    yield c
    c.execute("select pgmq.purge_queue('extract')")
    c.close()


def as_user(c, uid):
    c.execute("select set_config('request.jwt.claims', %s, false), set_config('role', 'authenticated', false)",
              (json.dumps({"sub": uid, "role": "authenticated", "aal": "aal1"}),))


def as_owner(c):
    c.execute("reset role; select set_config('request.jwt.claims', '', false)")


def product(c):
    """A new editor (the workspace admin), workspace, family and product; returns (user id, workspace, product)."""
    uid = str(uuid.uuid4())
    c.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"t303-{uid[:8]}@t303.test"))
    as_user(c, uid)
    ws = str(c.execute("select app.create_workspace('T-303 test') as id").fetchone()["id"])
    as_owner(c)
    fam = c.execute("insert into app.families (workspace_id, name) values (%s, 'Family') returning id",
                    (ws,)).fetchone()["id"]
    prod = c.execute("insert into app.products (workspace_id, family_id, name, stage) values (%s, %s, 'Product', "
                     "'in_development') returning id", (ws, fam)).fetchone()["id"]
    return uid, ws, str(prod)


def register(c, uid, ws, prod, data, name="label.pdf", mime="application/pdf"):
    sha = hashlib.sha256(data).hexdigest()
    as_user(c, uid)
    av = c.execute("select app.register_artwork(%s, %s, %s, %s, %s) as id",
                   (prod, f"{ws}/{prod}/{sha}.pdf", sha, name, mime)).fetchone()["id"]
    as_owner(c)
    return str(av)


def job_of(c, av):
    row = c.execute("select id, kind, workspace_id, payload, attempts from app.jobs where idempotency_key = %s",
                    (f"extract:{av}",)).fetchone()
    return Job(str(row["id"]), row["kind"], str(row["workspace_id"]), row["payload"], row["attempts"])


def run(c, av, data):
    job = job_of(c, av)
    return h.run_extract(job, JobContext(job, PgStore(c), S), h.PgArtworkStore(c), lambda b, p: data)


def panels(c, av):
    return c.execute("""select p.id, p.page, p.panel_index, p.bbox_mm, p.language, p.status, p.failure_code
                          from app.artwork_panels p where p.artwork_version_id = %s
                         order by p.panel_index""", (av,)).fetchall()


def text_objects(c, av):
    return c.execute("""select t.* from app.text_objects t join app.artwork_panels p on p.id = t.panel_id
                         where p.artwork_version_id = %s""", (av,)).fetchall()


def truth(name):
    return json.loads((SYNTH / f"{name}.truth.json").read_text(encoding="utf-8"))


def test_D01_must_1_one_row_per_printed_panel(conn):
    data = (SYNTH / "mixed_9panels.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    run(conn, av, data)
    rows = panels(conn, av)
    want = truth("mixed_9panels")["panels"]
    assert len(rows) == len(want) == 9
    assert [r["panel_index"] for r in rows] == list(range(9))
    assert [(r["status"], r["failure_code"]) for r in rows] == \
        [(w["expected_status"], w["expected_failure"]) for w in want]
    assert {r["language"] for r in rows if r["status"] == "extracted"} == \
        {w["language"] for w in want if w["expected_status"] == "extracted"}
    page = conn.execute("select page_count, page_size_mm from app.artwork_versions where id = %s", (av,)).fetchone()
    assert page["page_count"] == 1 and len(page["page_size_mm"]) == 2 and all(v > 0 for v in page["page_size_mm"])


def test_D01_must_2_both_heights_on_every_text_object(conn):
    data = (SYNTH / "clean_3lang.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    run(conn, av, data)
    objs = text_objects(conn, av)
    assert len(objs) == sum(len(p["text_objects"]) for p in truth("clean_3lang")["panels"])
    assert all(o["x_height_mm"] > 0 and o["cap_height_mm"] > o["x_height_mm"] for o in objs)
    assert all(len(o["bbox_mm"]) == 4 and o["font_size_pt"] > 0 and o["is_ocr"] is False for o in objs)
    assert all(str(o["workspace_id"]) == ws and str(o["product_id"]) == prod for o in objs)


def test_D01_must_3_partial_results_with_named_failures_never_one_file_level_error(conn):
    data = (SYNTH / "mixed_9panels.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    result = run(conn, av, data)
    assert result["status"] == "partial"
    assert result["failure_codes"] == sorted({w["expected_failure"] for w in truth("mixed_9panels")["panels"]
                                              if w["expected_failure"]})
    rows = panels(conn, av)
    extracted = [r for r in rows if r["status"] == "extracted"]
    failed = [r for r in rows if r["status"] == "not_assessable"]
    assert extracted and failed and all(r["failure_code"] for r in failed)
    with_text = {str(o["panel_id"]) for o in text_objects(conn, av)}
    assert with_text == {str(r["id"]) for r in extracted}    # successful panels persist; failed ones carry no text


def test_D01_must_4_idempotent_per_file_hash(conn):
    data = (SYNTH / "small_netqty.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    assert register(conn, uid, ws, prod, data, name="renamed.pdf") == av          # the same bytes: the same version
    assert conn.execute("select count(*) as n from app.jobs where idempotency_key = %s",
                        (f"extract:{av}",)).fetchone()["n"] == 1
    first = run(conn, av, data)
    counts = (len(panels(conn, av)), len(text_objects(conn, av)))
    again = run(conn, av, None)                       # a retry or duplicate delivery: nothing is read again
    assert again["id"] == first["id"] and (len(panels(conn, av)), len(text_objects(conn, av))) == counts
    assert conn.execute("select count(*) as n from app.extraction_runs where artwork_version_id = %s",
                        (av,)).fetchone()["n"] == 1


def test_D01_must_4_concurrent_attempts_persist_one_run(conn):
    data = (SYNTH / "small_netqty.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    art = h.PgArtworkStore(conn).artwork(av)
    result = h.extract_bytes(data)
    key = h.run_key(av, art.file_sha256)
    other = connect(DSN)
    try:
        a = h.PgArtworkStore(conn).persist(art, key, result, datetime.now(UTC))
        b = h.PgArtworkStore(other).persist(art, key, result, datetime.now(UTC))
    finally:
        other.close()
    assert a["id"] == b["id"] and a["panels"] == b["panels"] == len(panels(conn, av))


def test_D01_fail_1_raster_or_photo_is_rasterised_and_geometry_is_never_guessed(conn):
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, PNG, name="pack-photo.png", mime="image/png")
    result = run(conn, av, PNG)
    [row] = panels(conn, av)
    assert (row["status"], row["failure_code"]) == ("not_assessable", "rasterised")
    assert [float(v) for v in row["bbox_mm"]] == [0, 0, 0, 0] and text_objects(conn, av) == []
    assert result["status"] == "failed"
    page = conn.execute("select page_count, page_size_mm from app.artwork_versions where id = %s", (av,)).fetchone()
    assert page == {"page_count": None, "page_size_mm": None}
    # A raster PDF is the same failure, per panel, from the engine (BE-18).
    data = (SYNTH / "rasterised.pdf").read_bytes()
    av2 = register(conn, uid, ws, prod, data)
    run(conn, av2, data)
    assert {(r["status"], r["failure_code"]) for r in panels(conn, av2)} == {("not_assessable", "rasterised")}
    assert text_objects(conn, av2) == []


def test_D01_fail_2_outlined_text_is_outlined_text(conn):
    data = (SYNTH / "outlined_all.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    run(conn, av, data)
    rows = panels(conn, av)
    assert len(rows) == len(truth("outlined_all")["panels"])
    assert {(r["status"], r["failure_code"]) for r in rows} == {("not_assessable", "outlined_text")}
    assert text_objects(conn, av) == []


def test_D01_fail_3_fonts_not_embedded_is_missing_font(conn, tmp_path):
    reportlab = pytest.importorskip("reportlab.pdfgen.canvas")
    from reportlab.lib.units import mm

    path = tmp_path / "standard14.pdf"
    c = reportlab.Canvas(str(path), pagesize=(120 * mm, 80 * mm))
    c.setFont("Helvetica", 9)                          # a standard-14 font: never embedded
    for i, line in enumerate(["Complete feed for adult dogs", "Composition: chicken, rice", "Net weight 2 kg"]):
        c.drawString(10 * mm, (70 - 5 * i) * mm, line)
    c.save()
    data = path.read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    result = run(conn, av, data)
    rows = panels(conn, av)
    assert rows and {(r["status"], r["failure_code"]) for r in rows} == {("not_assessable", "missing_font")}
    assert text_objects(conn, av) == [] and result["failure_codes"] == ["missing_font"]


def test_a_member_of_another_workspace_cannot_read_the_extraction(conn):
    data = (SYNTH / "small_netqty.pdf").read_bytes()
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    run(conn, av, data)
    stranger, _, _ = product(conn)
    as_user(conn, stranger)
    try:
        seen = conn.execute("""select (select count(*) from app.artwork_panels where artwork_version_id = %s) as p,
                                      (select count(*) from app.extraction_runs where artwork_version_id = %s) as r,
                                      (select count(*) from app.jobs where idempotency_key = %s) as j""",
                            (av, av, f"extract:{av}")).fetchone()
    finally:
        as_owner(conn)
    assert seen == {"p": 0, "r": 0, "j": 0}


def storage_or_skip() -> StorageClient:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        try:
            out = subprocess.run(["supabase", "status", "-o", "json"], cwd=ROOT, capture_output=True, text=True,
                                 timeout=60, check=False).stdout
            status = json.loads(out[out.index("{"):])
            url, key = status["API_URL"], status["SERVICE_ROLE_KEY"]
        except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
            skip_no_service("storage", "run make db-start (supabase status gave no API URL and service key)")
    client = StorageClient(url, key)
    try:
        client.transport.send("GET", f"{client.url}/storage/v1/bucket/artwork",
                              {"Authorization": f"Bearer {key}", "apikey": key})
    except TransportError:
        skip_no_service("storage", "the Storage API does not answer")
    return client


def work(storage):
    """The job loop with the registered extract handler until the queue is idle, on the local stack's Storage."""
    reg = Registry()
    reg.register("extract")(registry.get("extract").fn)
    settings = S.model_copy(update={"supabase_url": storage.url, "supabase_service_role_key": SecretStr(storage._key)})
    Worker(settings, reg, lambda: PgStore(connect(DSN))).run(max_idle_loops=3)


def test_D01_main_upload_register_extract_and_progress_end_to_end(conn):
    storage = storage_or_skip()
    data = (SYNTH / "clean_3lang.pdf").read_bytes()
    uid, ws, prod = product(conn)
    sha = hashlib.sha256(data).hexdigest()
    storage.put("artwork", f"{ws}/{prod}/{sha}.pdf", data, "application/pdf")
    av = register(conn, uid, ws, prod, data)
    work(storage)
    job = conn.execute("select status, attempts, last_error, progress from app.jobs where idempotency_key = %s",
                       (f"extract:{av}",)).fetchone()
    assert (job["status"], job["attempts"], job["last_error"]) == ("succeeded", 1, None)
    progress = job["progress"]
    assert progress["stage"] == "done" and progress["status"] == "succeeded"
    assert progress["panels"] == progress["panels_extracted"] == 3 and progress["failure_codes"] == []
    assert progress["text_objects"] == len(text_objects(conn, av)) > 0
    assert not any(isinstance(v, str) and "Complete feed" in v for v in progress.values())   # ids and counts only
    assert [r["language"] for r in panels(conn, av)] == [p["language"] for p in truth("clean_3lang")["panels"]]


def test_a_registered_artwork_missing_from_storage_ends_failed_with_a_safe_error(conn):
    storage = storage_or_skip()
    data = (SYNTH / "small_netqty.pdf").read_bytes() + b"\n% never uploaded " + uuid.uuid4().bytes
    uid, ws, prod = product(conn)
    av = register(conn, uid, ws, prod, data)
    work(storage)
    job = conn.execute("select status, last_error from app.jobs where idempotency_key = %s",
                       (f"extract:{av}",)).fetchone()
    assert job["status"] == "failed"
    assert job["last_error"] == f"PermanentJobError: artwork version {av}: the file is missing from storage"
    assert panels(conn, av) == []

