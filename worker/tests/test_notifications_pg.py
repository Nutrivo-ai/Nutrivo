"""O01 end to end on the local stack: a notify job queued by private.enqueue, run through the real loop on PgStore,
writing app.notifications rows that each person reads under RLS, and emails that really reach Mailpit. Plus every
other template's store query against the real schema.

Each test runs in one transaction that is rolled back; ref rows are synthetic and never leave it. Emails go to fresh
addresses and are deleted afterwards. Locally the tests skip without the stack; CI's worker job fails such a skip
(tests/pgtest.py)."""
import hashlib
import json
import re
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from pgtest import DSN, MAILPIT_URL, connect_or_skip, skip_no_service
from psycopg.types.json import Jsonb

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import notify  # noqa: F401  registers notify
from nutrivo_worker.jobs import Message, process_message, registry

S = Settings(max_attempts=5, mailpit_url=MAILPIT_URL)


def mailpit(path, method="GET"):
    with urllib.request.urlopen(urllib.request.Request(f"{MAILPIT_URL}{path}", method=method), timeout=5) as r:
        return json.loads(r.read() or b"{}") if method == "GET" else None


class World:
    """A workspace created by Anna (admin, everything in scope); Boris, an editor scoped to another recipe; Carl, a
    viewer who turned rule-change emails off; Dora, whose membership ended. Two recipes, three products, one check."""

    def __init__(self, conn):
        self.conn, self.tag = conn, uuid.uuid4().hex[:12]
        self.ws = self.id()
        self.anna = self.person("anna", "Anna Berg")
        conn.execute("insert into app.workspaces (id, name, created_by) values (%s, 'Halden Pet Nutrition', %s)",
                     (self.ws, self.anna["pid"]))
        conn.execute("insert into app.allowances (workspace_id) values (%s)", (self.ws,))
        self.fam_a, self.fam_b = self.id(), self.id()
        for fam, name in ((self.fam_a, "Senior range"), (self.fam_b, "Puppy range")):
            conn.execute("insert into app.families (id, workspace_id, name) values (%s, %s, %s)", (fam, self.ws, name))
        self.member(self.anna, "admin")
        self.boris = self.member(self.person("boris", "Boris Lund"), "editor", families=[self.fam_b])
        self.carl = self.member(self.person("carl", "Carl Ek"), "viewer")
        self.dora = self.member(self.person("dora", "Dora Falk"), "editor", ended=True)
        conn.execute("insert into app.notification_prefs (person_id, kind, channel, enabled) "
                     "values (%s, 'rule_changed', 'email', false)", (self.carl["pid"],))
        self.salmon = self.product(self.fam_a, "Senior salmon · complete dry")
        self.topper = self.product(self.fam_a, "Joint support topper")
        self.puppy = self.product(self.fam_b, "Puppy complete wet")
        self.ruleset = f"t602-{self.tag}"
        conn.execute("insert into ref.ruleset_versions (id, notes) values (%s, 'T-602 test')", (self.ruleset,))
        self.rule = f"TEST.T602.{self.tag.upper()}"
        conn.execute("insert into ref.rules (rule_key, shape, domain, node_id, title) values "
                     "(%s, 'prescribed_wording', 'claims_wording', 'EU-FR', 'Synthetic rule for the T-602 tests')",
                     (self.rule,))
        self.check = self.id()
        for pid in (self.salmon, self.topper):
            conn.execute("insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state,"
                         " applied_rule_keys) values (%s, %s, %s, 'EU-FR', %s, 'action', %s)",
                         (self.check if pid == self.salmon else self.id(), self.ws, pid, self.ruleset, [self.rule]))

    @staticmethod
    def id():
        return str(uuid.uuid4())

    def address(self, name):
        return f"{name}.{self.tag}@halden.test"

    def person(self, name, display):
        uid, pid = self.id(), self.id()
        self.conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, self.address(name)))
        self.conn.execute("insert into app.people (id, user_id, display_name, email) values (%s, %s, %s, %s)",
                          (pid, uid, display, self.address(name)))
        return {"uid": uid, "pid": pid, "email": self.address(name)}

    def member(self, who, role, families=None, ended=False):
        self.conn.execute("insert into app.memberships (workspace_id, person_id, role, scope_family_ids, ended_at) "
                          "values (%s, %s, %s, %s, %s)",
                          (self.ws, who["pid"], role, families, datetime.now(UTC) if ended else None))
        return who

    def product(self, fam, name):
        pid = self.id()
        self.conn.execute("insert into app.products (id, workspace_id, family_id, name, stage) "
                          "values (%s, %s, %s, %s, 'active')", (pid, self.ws, fam, name))
        return pid

    def diff(self, effect_type):
        return self.conn.execute("insert into ref.rule_diffs (ruleset_version, rule_key, effect_type, effective_from) "
                                 "values (%s, %s, %s, %s) returning id::text",
                                 (self.ruleset, self.rule, effect_type, datetime.now(UTC).date() + timedelta(days=58))
                                 ).fetchone()["id"]

    def enqueue(self, key, payload):
        return self.conn.execute("select private.enqueue('notify', %s, %s, %s)::text as id",
                                 (self.ws, key, Jsonb(payload))).fetchone()["id"]

    def run(self, job_id):
        msg = self.conn.execute("select msg_id from pgmq.q_notify where message->>'job_id' = %s order by msg_id desc",
                                (job_id,)).fetchone()
        outcome = process_message(PgStore(self.conn), registry, Message(msg["msg_id"], "notify", {"job_id": job_id}), S)
        return outcome, self.conn.execute("select status, progress, last_error from app.jobs where id = %s",
                                          (job_id,)).fetchone()

    def notifications(self):
        return self.conn.execute("select person_id::text, kind, severity, object_ref, read_at from app.notifications "
                                 "where workspace_id = %s order by person_id", (self.ws,)).fetchall()

    @contextmanager
    def as_user(self, who):
        with self.conn.transaction():
            self.conn.execute("select set_config('request.jwt.claims', %s, true)",
                              (json.dumps({"sub": who["uid"], "role": "authenticated"}),))
            self.conn.execute("set local role authenticated")
            yield
            self.conn.execute("reset role")

    def emails_to(self, who):
        return [mailpit(f"/api/v1/message/{m['ID']}")
                for m in mailpit(f"/api/v1/search?query=to:{urllib.parse.quote(who['email'])}")["messages"]]


@pytest.fixture
def world():
    conn = connect_or_skip(connect, DSN)
    try:
        mailpit("/api/v1/info")
    except OSError:
        conn.close()
        skip_no_service("Mailpit")
    conn.autocommit = False
    w = World(conn)
    try:
        yield w
    finally:
        conn.rollback()
        conn.close()
        for m in mailpit(f"/api/v1/search?query={w.tag}")["messages"]:
            mailpit(f"/api/v1/messages?ids={m['ID']}", method="DELETE")


def test_O01_main_a_rule_change_notifies_in_app_and_by_email_with_per_person_read_state(world):
    diff = world.diff("prescribed_wording")
    job = world.enqueue(f"rule:{diff}:{world.ws}", {"template": "rule_changed", "rule_diff_id": diff})
    outcome, row = world.run(job)
    assert outcome == "succeeded", row
    assert row["progress"]["outcome"] == "sent" and row["progress"]["in_app"] == 2

    # Anna and Carl hold the recipe; Boris's scope is another recipe and Dora's membership ended.
    rows = world.notifications()
    assert {r["person_id"] for r in rows} == {world.anna["pid"], world.carl["pid"]}
    assert all(r["kind"] == "rule_changed" and r["severity"] == "warning" and r["read_at"] is None for r in rows)
    assert rows[0]["object_ref"]["product_ids"] == sorted([world.salmon, world.topper])

    # Each person reads only their own row under RLS: read state is per person.
    for who in (world.anna, world.carl, world.boris):
        with world.as_user(who):
            mine = world.conn.execute("select person_id::text from app.notifications").fetchall()
        assert [r["person_id"] for r in mine] == ([] if who is world.boris else [who["pid"]])

    # Carl turned rule-change emails off; Anna's email names both recipes and lands in Mailpit.
    [anna] = world.emails_to(world.anna)
    assert world.emails_to(world.carl) == [] and world.emails_to(world.boris) == []
    assert anna["Subject"] == "A prescribed wording changed in France. Two of your recipes use it."
    assert "Joint support topper and Senior salmon · complete dry use it." in anna["Text"]
    assert "Synthetic rule for the T-602 tests" in anna["HTML"]

    # Delivered again (a worker died before acknowledging): no second row, no second email.
    world.conn.execute("update app.jobs set status = 'queued' where id = %s", (job,))
    world.conn.execute("select pgmq.send('notify', %s::jsonb)", (json.dumps({"job_id": job}),))
    assert world.run(job)[1]["progress"]["outcome"] == "already_sent"
    assert len(world.notifications()) == 2 and len(world.emails_to(world.anna)) == 1


def test_O01_must_1_an_editorial_diff_never_notifies_on_the_real_schema(world):
    diff = world.diff("editorial")
    job = world.enqueue(f"rule:{diff}:{world.ws}", {"template": "rule_changed", "rule_diff_id": diff})
    outcome, row = world.run(job)
    assert outcome == "succeeded" and row["progress"] == {"outcome": "skipped_editorial"}
    assert world.notifications() == [] and world.emails_to(world.anna) == []


def test_a_report_shared_by_email_reaches_its_addressee_with_the_counts_and_a_link_only_hashed(world):
    report, share = world.id(), world.id()
    world.conn.execute("insert into app.reports (id, workspace_id, product_id, ref, check_ids, ruleset_version, "
                       "artwork_sha, has_not_assessed, created_by) values (%s, %s, %s, %s, %s, %s, 'sha', true, %s)",
                       (report, world.ws, world.salmon, f"NTV-T602-{world.tag}-REF", [world.check], world.ruleset,
                        world.anna["pid"]))
    world.conn.execute("insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state, "
                       "provenance, message) values (%s, %s, %s, 'EU-FR', %s, 'action', 'deterministic_rule', 'm')",
                       (world.ws, world.check, world.salmon, world.rule))
    buyer = {"email": world.address("buyer")}
    world.conn.execute("insert into app.shares (id, workspace_id, report_id, token_hash, channel, recipient, "
                       "created_by) values (%s, %s, %s, %s, 'email', %s, %s)",
                       (share, world.ws, report, uuid.uuid4().bytes, buyer["email"], world.anna["pid"]))
    outcome, row = world.run(world.enqueue(f"share:{share}", {"template": "report", "share_id": share}))
    assert outcome == "succeeded", row
    [e] = world.emails_to(buyer)
    assert e["Subject"] == "Halden Pet Nutrition sent you a label compliance report"
    for part in ("Anna Berg at Halden Pet Nutrition sent you a report", "for one market and zero printed language",
                 "- Clear: 0", "- Action needed: 1", "- Not assessed: 0", "- Blocked: 0"):
        assert part in e["Text"]
    [token] = re.findall(r"/share/([A-Za-z0-9_-]{43})", e["Text"])
    stored = world.conn.execute("select token_hash from app.shares where id = %s", (share,)).fetchone()["token_hash"]
    assert bytes(stored) == hashlib.sha256(token.encode()).digest()
    assert world.notifications() == []                     # an addressee with no account gets no row


def test_the_document_notice_and_the_allowance_email_read_the_real_schema(world):
    sup, doc = world.id(), world.id()
    world.conn.execute("insert into app.suppliers (id, workspace_id, name) values (%s, %s, 'Nordwild Feeds')",
                       (sup, world.ws))
    world.conn.execute("insert into app.supplier_documents (id, workspace_id, supplier_id, product_id, doc_type, "
                       "storage_path, file_sha256, valid_to, uploaded_via) values (%s, %s, %s, %s, "
                       "'PMX-118 premix specification', 'p', 's', %s, 'member')",
                       (doc, world.ws, sup, world.salmon, datetime.now(UTC).date() + timedelta(days=30)))
    outcome, row = world.run(world.enqueue(f"doc:{doc}:30", {"template": "document_expiring", "document_id": doc,
                                                             "notice_days": 30, "person_ids": [world.carl["pid"]]}))
    assert outcome == "succeeded" and row["progress"]["in_app"] == 1, row
    [e] = world.emails_to(world.carl)
    assert e["Subject"] == "The PMX-118 premix specification expires in 30 days"
    assert "- Recipes citing it: 1" in e["Text"] and "- Supplier: NORDWILD FEEDS" in e["Text"]

    world.conn.execute("update app.allowances set labels_used = 3 where workspace_id = %s", (world.ws,))
    outcome, row = world.run(world.enqueue(f"allowance:{world.ws}", {"template": "allowance_used"}))
    assert outcome == "succeeded", row
    [e] = world.emails_to(world.anna)
    assert e["Subject"] == "That was your third free label"
    assert "the 2 checks you have run stay" in e["Text"]
    assert {r["kind"] for r in world.notifications()} == {"document_expiring", "allowance_used"}


def test_a_receipt_without_its_pdf_fails_visibly_and_sends_nothing(world):
    evt = f"evt_t602{world.tag}"
    world.conn.execute("insert into app.subscriptions (workspace_id, plan, term, status) "
                       "values (%s, 'standard', 'annual', 'active')", (world.ws,))
    world.conn.execute("insert into app.payment_events (stripe_event_id, workspace_id, type, payload) "
                       "values (%s, %s, 'invoice.paid', %s)",
                       (evt, world.ws, Jsonb({"data": {"object": {
                           "id": "in_1", "number": "NTV-1", "currency": "eur", "customer_email": world.anna["email"],
                           "subtotal": 100, "tax": 25, "amount_paid": 125, "period_start": 1, "period_end": 2}}})))
    outcome, row = world.run(world.enqueue(f"receipt:{evt}", {"template": "receipt", "payment_event_id": evt}))
    assert outcome == "failed" and row["last_error"].endswith("the invoice PDF is not available")
    assert world.emails_to(world.anna) == []
