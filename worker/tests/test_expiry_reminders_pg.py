"""T-803 · H04 end to end on the local stack: the daily job pg_cron queues (private.enqueue_expiry_reminders), run
through the real loop on PgStore, queues one document_expiring notify job per document and notice, ids only; those
jobs send Template 04 and write the in-app rows. A second run, the same day or later, queues nothing new.

Each test runs in one transaction that is rolled back. Locally the tests skip without the stack; CI's worker job fails
such a skip (tests/pgtest.py)."""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fakes import FakeMailer
from pgtest import DSN, connect_or_skip

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import expiry, notify
from nutrivo_worker.jobs import Message, Registry, process_message

S = Settings(max_attempts=5, app_base_url="https://app.nutrivo.test")
TODAY = datetime.now(UTC).date()


class NamedDocuments(PgStore):
    """Until a document's display name is stored, Template 04 fails visibly (docs/04-contracts.md, #70 Q3); the
    test names the documents so the notices can be followed to the email and the in-app row."""

    def document_for_notice(self, document_id):
        doc = super().document_for_notice(document_id)
        return doc and {**doc, "display_name": "Certificate of analysis"}


class World:
    """Halden: Anna (admin), Eve (editor, requested one document), Rolf (editor, recorded a registration citing it),
    Dora (editor, membership ended, recorded a registration citing it too). A closed workspace with an expiring
    document of its own."""

    def __init__(self, conn):
        self.conn, self.tag = conn, uuid.uuid4().hex[:12]
        self.ws, self.closed = self.id(), self.id()
        conn.execute("insert into app.workspaces (id, name) values (%s, 'Halden Pet Nutrition')", (self.ws,))
        conn.execute("insert into app.workspaces (id, name, status) values (%s, 'Gone Pet Co', 'closed')",
                     (self.closed,))
        self.anna, self.eve = self.member("anna", "admin"), self.member("eve", "editor")
        self.rolf, self.dora = self.member("rolf", "editor"), self.member("dora", "editor", ended=True)
        fam = self.id()
        conn.execute("insert into app.families (id, workspace_id, name) values (%s, %s, 'Senior range')", (fam, self.ws))
        self.product = self.id()
        conn.execute("insert into app.products (id, workspace_id, family_id, name, stage) "
                     "values (%s, %s, %s, 'Senior salmon', 'active')", (self.product, self.ws, fam))
        self.supplier = self.id()
        conn.execute("insert into app.suppliers (id, workspace_id, name, email) "
                     "values (%s, %s, 'Nordwild Feeds', 'qa@nordwild.test')", (self.supplier, self.ws))
        self.mailer = FakeMailer()
        self.reg = Registry()
        self.reg.register("expiry_reminders")(lambda j, ctx: expiry.expiry_reminders(j, ctx, ctx.store))
        self.reg.register("notify")(lambda j, ctx: notify.send_document_expiring(j, ctx, ctx.store, self.mailer))

    @staticmethod
    def id():
        return str(uuid.uuid4())

    def member(self, name, role, ended=False):
        uid, pid, email = self.id(), self.id(), f"{name}.{self.tag}@halden.test"
        self.conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
        self.conn.execute("insert into app.people (id, user_id, display_name, email) values (%s, %s, %s, %s)",
                          (pid, uid, name.title(), email))
        self.conn.execute("insert into app.memberships (workspace_id, person_id, role, ended_at) values (%s, %s, %s, %s)",
                          (self.ws, pid, role, datetime.now(UTC) if ended else None))
        return pid

    def document(self, days, *, ws=None, scan="clean", doc_type="certificate_of_analysis", requested_by=None):
        ws, doc, request = ws or self.ws, self.id(), None
        supplier = self.supplier if ws == self.ws else None
        if requested_by:
            request = self.id()
            self.conn.execute("insert into app.document_requests (id, workspace_id, supplier_id, product_id, doc_type, "
                              "title, created_by) values (%s, %s, %s, %s, %s, 'Current CoA', %s)",
                              (request, ws, supplier, self.product, doc_type, requested_by))
        self.conn.execute("insert into app.supplier_documents (id, workspace_id, supplier_id, product_id, doc_type, "
                          "storage_path, file_sha256, valid_to, uploaded_via, scan_status, request_id) "
                          "values (%s, %s, %s, %s, %s, 'p', 's', %s, %s, %s, %s)",
                          (doc, ws, supplier, self.product if ws == self.ws else None, doc_type,
                           TODAY + timedelta(days=days), "supplier_link" if request else "member", scan, request))
        return doc

    def cites(self, doc, person):
        self.conn.execute("insert into app.registrations (workspace_id, product_id, node_id, number, registered_on, "
                          "evidence_doc_id, recorded_by) values (%s, %s, 'EU-FR', 'FR-1', %s, %s, %s)",
                          (self.ws, self.product, TODAY - timedelta(days=300), doc, person))

    def run(self, kind, job_id, store=PgStore):
        msg = self.conn.execute(f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s order by msg_id desc",
                                (str(job_id),)).fetchone()
        outcome = process_message(store(self.conn), self.reg, Message(msg["msg_id"], kind, {"job_id": str(job_id)}), S)
        return outcome, self.conn.execute("select status, progress, last_error from app.jobs where id = %s",
                                          (job_id,)).fetchone()

    def notices(self):
        return {r["key"]: r for r in self.conn.execute(
            """select idempotency_key as key, id::text, workspace_id::text as ws, payload from app.jobs
                where kind = 'notify' and idempotency_key like 'doc:%%'
                  and workspace_id in (%s, %s)""", (self.ws, self.closed)).fetchall()}


@pytest.fixture
def world():
    conn = connect_or_skip(connect, DSN)
    conn.autocommit = False
    try:
        yield World(conn)
    finally:
        conn.rollback()
        conn.close()


def test_H04_main_expiring_documents_get_one_notice_per_threshold_by_email_and_in_app(world):
    w = world
    soon = w.document(25, requested_by=w.eve)            # the 30-day notice, to Eve and Rolf
    w.cites(soon, w.rolf)
    w.cites(soon, w.dora)                                 # ended: named, then dropped by the notify job
    week = w.document(5, doc_type="gmp_certificate")                                # the 7-day notice: no owner, so the admins only
    w.document(90, doc_type="haccp_plan")                # not yet
    w.document(10, scan="quarantine", doc_type="analysis_report")   # never scanned clean
    w.document(-1, doc_type="organic_certificate")       # already expired
    w.document(20, doc_type="feed_label_approval")        # replaced by a newer clean copy that runs later
    w.document(400, doc_type="feed_label_approval")
    w.document(10, ws=w.closed)                           # a closed workspace gets nothing

    job = w.conn.execute("select private.enqueue_expiry_reminders() as id").fetchone()["id"]
    assert w.conn.execute("select private.enqueue_expiry_reminders() as id").fetchone()["id"] == job   # once a day
    assert w.conn.execute("select idempotency_key, payload from app.jobs where id = %s", (job,)).fetchone() == {
        "idempotency_key": f"expiry_reminders:{TODAY:%Y-%m-%d}", "payload": {}}
    outcome, row = w.run("expiry_reminders", job)
    assert outcome == "succeeded" and row["progress"]["queued"] == 2, row

    notices = w.notices()
    assert set(notices) == {f"doc:{soon}:30", f"doc:{week}:7"}
    assert notices[f"doc:{soon}:30"]["payload"] == {
        "template": "document_expiring", "document_id": soon, "notice_days": 30,
        "person_ids": sorted([w.eve, w.rolf, w.dora])}                         # ids only
    assert notices[f"doc:{week}:7"]["payload"] == {
        "template": "document_expiring", "document_id": week, "notice_days": 7, "person_ids": []}
    assert {n["ws"] for n in notices.values()} == {w.ws}
    assert w.conn.execute("""select count(*) as n from app.audit_events where workspace_id = %s
                              and kind = 'document.expiry_notice_queued'""", (w.ws,)).fetchone()["n"] == 2

    for n in notices.values():
        assert w.run("notify", n["id"], store=NamedDocuments)[0] == "succeeded"
    sent = sorted((e.to.split(".")[0], e.subject) for e in w.mailer.sent)
    assert sent == [("anna", "The Certificate of analysis expires in 5 days"),
                    ("eve", "The Certificate of analysis expires in 25 days"),
                    ("rolf", "The Certificate of analysis expires in 25 days")]
    rows = w.conn.execute("""select person_id::text, kind, object_ref from app.notifications where workspace_id = %s
                              order by person_id""", (w.ws,)).fetchall()
    assert sorted((r["person_id"], r["object_ref"]["notice_days"]) for r in rows) == sorted(
        [(w.anna, 7), (w.eve, 30), (w.rolf, 30)])
    assert {r["kind"] for r in rows} == {"document_expiring"}

    # Idempotent: the producer again (a retry, or tomorrow's run at the same thresholds) queues nothing new.
    assert PgStore(w.conn).queue_expiry_reminders("again") == {"queued": 0, "already": 2}
    assert set(w.notices()) == set(notices)


def test_H04_only_the_nearest_threshold_is_queued_so_a_missed_notice_is_never_sent_late(world):
    w = world
    early = w.document(45, requested_by=w.eve)
    late = w.document(6, requested_by=w.eve, doc_type="gmp_certificate")
    store = PgStore(w.conn)
    assert store.queue_expiry_reminders("r1") == {"queued": 2, "already": 0}
    assert set(w.notices()) == {f"doc:{early}:60", f"doc:{late}:7"}          # never 60 or 30 for the late one
    assert store.queue_expiry_reminders("r2") == {"queued": 0, "already": 2}
