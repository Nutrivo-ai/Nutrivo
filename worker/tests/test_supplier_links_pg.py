"""H02 and H03 on the local stack (T-802): app.request_document as an editor, the notify job through the real loop
and Mailpit (the supplier's email carries the link, the database only its hash), then the link through the two
functions the supplier-upload Edge Function calls, and the scan job through the real loop on the local Storage,
which promotes the upload as a new row.

Each test runs in one transaction that is rolled back (audit_events and supplier_documents are insert-only, so nothing
could be cleaned up otherwise); the worker's PgStore shares that connection. Emails really reach Mailpit, each to a
fresh address, and Storage objects are written under a fresh workspace id and removed afterwards. Locally they skip
without the stack; CI's worker job starts it and fails such a skip (tests/pgtest.py)."""
import hashlib
import json
import re
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager

import psycopg
import pytest
from pgtest import DSN, MAILPIT_URL, connect_or_skip, skip_no_service
from pydantic import SecretStr
from test_extract_pg import storage_or_skip

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import notify, scan  # noqa: F401  (registers notify and scan)
from nutrivo_worker.jobs import Message, process_message, registry
from nutrivo_worker.scanning import EICAR

LINK = re.compile(r"/supplier/([A-Za-z0-9_-]{43})")
PDF = b"%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n"


def mailpit(path, method="GET"):
    with urllib.request.urlopen(urllib.request.Request(f"{MAILPIT_URL}{path}", method=method), timeout=5) as r:
        return json.loads(r.read() or b"{}") if method == "GET" else None


class World:
    """One workspace with an editor and a viewer, and one encoded document type (inside the rolled-back test)."""

    def __init__(self, conn, settings):
        self.conn, self.tag, self.settings = conn, uuid.uuid4().hex[:12], settings
        self.ws = str(uuid.uuid4())
        conn.execute("insert into app.workspaces (id, name) values (%s, 'Kruuse Pet Nutrition')", (self.ws,))
        self.editor = self.user("carl", "Carl Berg", "editor")
        self.viewer = self.user("vera", "Vera Lind", "viewer")
        conn.execute("insert into ref.document_requirements (node_id, doc_type) values ('EU-SE', 't802_pg_spec')")

    def address(self, name):
        return f"{name}.{self.tag}@supplier.test"

    def user(self, name, display, role):
        uid, pid = str(uuid.uuid4()), str(uuid.uuid4())
        self.conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, self.address(name)))
        self.conn.execute("insert into app.people (id, user_id, display_name, email) values (%s, %s, %s, %s)",
                          (pid, uid, display, self.address(name)))
        self.conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, %s)",
                          (self.ws, pid, role))
        return {"uid": uid, "pid": pid}

    @contextmanager
    def as_user(self, who):
        with self.conn.transaction():
            self.conn.execute("select set_config('request.jwt.claims', %s, true)",
                              (json.dumps({"sub": who["uid"], "role": "authenticated"}),))
            self.conn.execute("set local role authenticated")
            yield
            self.conn.execute("reset role")

    def request(self, who, email, title="Current premix specification"):
        with self.as_user(who):
            return self.conn.execute("select app.request_document(%s, %s, 't802_pg_spec', null, 'Aldrich Nutrition', %s)"
                                     " as r", (self.ws, title, email)).fetchone()["r"]

    def run(self, kind, key):
        job = self.conn.execute("select id::text from app.jobs where idempotency_key = %s", (key,)).fetchone()
        msg = self.conn.execute(f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s",
                                (job["id"],)).fetchone()
        outcome = process_message(PgStore(self.conn), registry, Message(msg["msg_id"], kind, {"job_id": job["id"]}),
                                  self.settings)
        return outcome, self.conn.execute("select status, payload, progress, last_error from app.jobs where id = %s",
                                          (job["id"],)).fetchone()

    def requeue(self, kind, key):
        """The same job delivered again, as pgmq does after a lost acknowledgement."""
        self.conn.execute("update app.jobs set status = 'queued' where idempotency_key = %s", (key,))
        self.conn.execute(f"select pgmq.send('{kind}', jsonb_build_object('job_id', id)) from app.jobs "
                          "where idempotency_key = %s", (key,))

    def token_for(self, address):
        [m] = mailpit(f"/api/v1/search?query=to:{urllib.parse.quote(address)}")["messages"]
        text = mailpit(f"/api/v1/message/{m['ID']}")["Text"]
        [token] = set(LINK.findall(text))
        return m, token

    def service(self, sql, *args):
        with self.conn.transaction():
            self.conn.execute("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")
            self.conn.execute("set local role service_role")
            row = self.conn.execute(sql, args).fetchone()
            self.conn.execute("reset role")
        return row["r"]

    def request_row(self, request_id):
        return self.conn.execute("select * from app.document_requests where id = %s", (request_id,)).fetchone()


@pytest.fixture
def world():
    conn = connect_or_skip(connect, DSN)
    try:
        mailpit("/api/v1/info")
    except OSError:
        conn.close()
        skip_no_service("Mailpit")
    storage = storage_or_skip()
    settings = Settings(max_attempts=5, mailpit_url=MAILPIT_URL, scan_mode="eicar_only", supabase_url=storage.url,
                        supabase_service_role_key=SecretStr(storage._key))
    conn.autocommit = False
    w = World(conn, settings)
    w.storage = storage
    w.objects = []
    try:
        yield w
    finally:
        conn.rollback()
        conn.close()
        for bucket, path in w.objects:   # best effort: a fresh workspace id per run keeps runs apart anyway
            key = storage._key
            storage.transport.send("DELETE", f"{storage.url}/storage/v1/object/{bucket}/{path}",
                                   {"Authorization": f"Bearer {key}", "apikey": key})
        for m in mailpit(f"/api/v1/search?query={w.tag}")["messages"]:
            mailpit(f"/api/v1/messages?ids={m['ID']}", method="DELETE")


def upload(world, token, request_id, data, name="premix-spec.pdf"):
    """What the supplier-upload Edge Function does once it has checked the file: store it in quarantine, then
    accept it with the token (supabase/functions/supplier-upload/upload.js)."""
    path = f"{world.ws}/{request_id}/{name}"
    world.storage.put("quarantine", path, data, "application/pdf")
    world.objects += [("quarantine", path), ("documents", path)]
    return path, world.service("select app.accept_supplier_upload(%s, %s, %s) as r", token, path,
                               hashlib.sha256(data).hexdigest())


# ── H02 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_H02_main_an_editor_requests_a_document_and_the_supplier_is_emailed_a_link(world):
    supplier = world.address("specs")
    r = world.request(world.editor, supplier.upper())
    row = world.request_row(r["request_id"])
    assert row["token_hash"] is None and row["title"] == "Current premix specification"
    outcome, job = world.run("notify", f"docreq:{r['request_id']}")
    assert outcome == "succeeded", job
    assert job["payload"] == {"template": "supplier_request", "document_request_id": r["request_id"]}
    assert job["progress"]["email"] == "sent" and job["last_error"] is None
    message, token = world.token_for(supplier)
    assert message["Subject"] == "Kruuse Pet Nutrition has asked you for a document"
    body = mailpit(f"/api/v1/message/{message['ID']}")["Text"]
    assert "Carl Berg at Kruuse Pet Nutrition asks for: Current premix specification." in body
    assert f"http://localhost:3000/supplier/{token}" in body
    assert world.request_row(r["request_id"])["token_hash"] == hashlib.sha256(token.encode()).digest()
    # A second run of the same job never mints again (that would kill the delivered link).
    world.requeue("notify", f"docreq:{r['request_id']}")
    outcome, job = world.run("notify", f"docreq:{r['request_id']}")
    assert outcome == "succeeded" and job["progress"]["outcome"] == "already_sent"


def test_H02_main_a_viewer_cannot_request_a_document(world):
    with pytest.raises(psycopg.Error) as exc:
        world.request(world.viewer, world.address("specs"))
    assert exc.value.sqlstate == "42501"


def test_H02_must_1_the_raw_token_is_never_stored(world):
    supplier = world.address("specs")
    r = world.request(world.editor, supplier)
    world.run("notify", f"docreq:{r['request_id']}")
    _, token = world.token_for(supplier)
    hits = world.conn.execute(
        """select (select count(*) from app.document_requests d where d::text like %(t)s)
                + (select count(*) from app.jobs j where j::text like %(t)s)
                + (select count(*) from app.audit_events a where a::text like %(t)s)
                + (select count(*) from app.suppliers s where s::text like %(t)s) as n""",
        {"t": f"%{token}%"}).fetchone()["n"]
    assert hits == 0
    assert world.request_row(r["request_id"])["token_hash"] == hashlib.sha256(token.encode()).digest()


# ── H03 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_H03_main_the_supplier_uploads_the_scan_promotes_a_new_row_and_the_request_is_fulfilled(world):
    supplier = world.address("specs")
    r = world.request(world.editor, supplier)
    world.run("notify", f"docreq:{r['request_id']}")
    _, token = world.token_for(supplier)
    described = world.service("select app.supplier_request_for_token(%s) as r", token)
    assert described["status"] == "open" and described["title"] == "Current premix specification"
    path, accepted = upload(world, token, r["request_id"], PDF)
    assert accepted["status"] == "accepted"
    quarantine_id = accepted["document_id"]

    outcome, job = world.run("scan", f"scan:{quarantine_id}")
    assert outcome == "succeeded", job
    assert job["payload"] == {"document_id": quarantine_id}
    assert job["progress"]["outcome"] == "promoted" and job["progress"]["scanner"] == "eicar_only"
    promoted = world.conn.execute("select * from app.supplier_documents where promoted_from = %s",
                                  (quarantine_id,)).fetchone()
    assert promoted["scan_status"] == "clean" and promoted["storage_path"] == path
    assert str(promoted["id"]) == job["progress"]["result_document_id"]
    assert world.conn.execute("select scan_status from app.supplier_documents where id = %s",
                              (quarantine_id,)).fetchone()["scan_status"] == "quarantine"
    assert world.storage.get("documents", path) == PDF
    req = world.request_row(r["request_id"])
    assert req["fulfilled_at"] is not None and str(req["document_id"]) == str(promoted["id"])

    # The scan job run again records nothing new.
    world.requeue("scan", f"scan:{quarantine_id}")
    outcome, job = world.run("scan", f"scan:{quarantine_id}")
    assert outcome == "succeeded" and job["progress"]["outcome"] == "already_recorded"


def test_H03_must_1_the_link_is_single_use_and_an_infected_file_is_never_promoted(world):
    supplier = world.address("specs")
    r = world.request(world.editor, supplier)
    world.run("notify", f"docreq:{r['request_id']}")
    _, token = world.token_for(supplier)
    _, accepted = upload(world, token, r["request_id"], PDF[:9] + EICAR)
    assert accepted["status"] == "accepted"
    _, again = upload(world, token, r["request_id"], PDF, name="second.pdf")
    assert again == {"status": "unknown"}
    assert world.service("select app.supplier_request_for_token(%s) as r", token) == {"status": "unknown"}

    outcome, job = world.run("scan", f"scan:{accepted['document_id']}")
    assert outcome == "succeeded" and job["progress"]["outcome"] == "rejected"
    rejected = world.conn.execute("select * from app.supplier_documents where promoted_from = %s",
                                  (accepted["document_id"],)).fetchone()
    assert rejected["scan_status"] == "rejected" and rejected["storage_path"].startswith("quarantine/")
    req = world.request_row(r["request_id"])
    assert req["consumed_at"] is not None and req["fulfilled_at"] is None
    # A notify job for a used request mints nothing.
    world.conn.execute("update app.jobs set progress = '{}' where idempotency_key = %s", (f"docreq:{r['request_id']}",))
    world.requeue("notify", f"docreq:{r['request_id']}")
    before = req["token_hash"]
    outcome, job = world.run("notify", f"docreq:{r['request_id']}")
    assert outcome == "succeeded" and job["progress"]["outcome"] == "skipped_used"
    assert world.request_row(r["request_id"])["token_hash"] == before


def test_H03_fail_1_an_expired_link_answers_exactly_unknown_and_is_never_issued(world):
    supplier = world.address("specs")
    r = world.request(world.editor, supplier)
    world.run("notify", f"docreq:{r['request_id']}")
    _, token = world.token_for(supplier)
    world.conn.execute("alter table app.document_requests disable trigger document_requests_guard")
    world.conn.execute("update app.document_requests set expires_at = now() - interval '1 minute' where id = %s",
                       (r["request_id"],))
    world.conn.execute("alter table app.document_requests enable trigger document_requests_guard")
    assert world.service("select app.supplier_request_for_token(%s) as r", token) == {"status": "unknown"}
    assert world.service("select app.accept_supplier_upload(%s, %s, %s) as r", token,
                         f"{world.ws}/{r['request_id']}/x.pdf", "ab" * 32) == {"status": "unknown"}
