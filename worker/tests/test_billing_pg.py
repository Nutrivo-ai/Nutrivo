"""M04 end to end on the local stack (T-702): Stripe events as the stripe-webhook function hands them to
app.record_stripe_event, billing_sync and billing_reconcile jobs run through the real loop on PgStore against an
in-memory Stripe, and the mirror, the workspace and public.verify_reference read back.

Each test runs in one transaction that is rolled back (app.payment_events is insert-only, so nothing may be left
behind). Locally the tests skip without the stack; CI's worker job fails such a skip (tests/pgtest.py)."""
import uuid

import psycopg
import pytest
from billing_fakes import FakeStripe, subscription
from pgtest import DSN, connect_or_skip
from psycopg.types.json import Jsonb

from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import billing
from nutrivo_worker.jobs import Message, Registry, process_message

S = Settings(max_attempts=5)


class World:
    """Workspace A, free, with one issued report somebody outside holds; Stripe has A's basic subscription."""

    def __init__(self, conn):
        self.conn, self.tag = conn, uuid.uuid4().hex[:12]
        self.ws, fam, product = (str(uuid.uuid4()) for _ in range(3))
        self.sub, self.cus = f"sub_{self.tag}", f"cus_{self.tag}"
        self.ref = f"nv-t702-{self.tag}-000000"
        conn.execute("insert into app.workspaces (id, name) values (%s, 'Halden Pet Nutrition')", (self.ws,))
        conn.execute("insert into app.allowances (workspace_id) values (%s)", (self.ws,))
        conn.execute("insert into app.families (id, workspace_id, name) values (%s, %s, 'Senior range')", (fam, self.ws))
        conn.execute("insert into app.products (id, workspace_id, family_id, name) values (%s, %s, %s, 'Senior dry')",
                     (product, self.ws, fam))
        conn.execute("""insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version,
                                                 artwork_sha, has_not_assessed)
                        values (%s, %s, 'EU-SE', %s, '{}', '0000.00-empty', 'sha-t702', true)""",
                     (self.ws, product, self.ref))
        self.stripe = FakeStripe(self.subscription("active"))
        self.reg = Registry()
        self.reg.register("billing_sync")(lambda j, ctx: billing.sync(j, ctx, ctx.store, self.stripe))
        self.reg.register("billing_reconcile")(lambda j, ctx: billing.reconcile(j, ctx, ctx.store, self.stripe))
        self.events = 0

    def subscription(self, status, **kw):
        return subscription(self.sub, status=status, ws=self.ws, customer=self.cus, **kw)

    def deliver(self, event_type, obj):
        """What the stripe-webhook function does once Stripe's signature is verified."""
        self.events += 1
        event = {"id": f"evt_{self.tag}_{self.events}", "object": "event", "type": event_type, "livemode": False,
                 "data": {"object": obj}}
        return event["id"], self.conn.execute("select app.record_stripe_event(%s) as r", (Jsonb(event),)).fetchone()["r"]

    def run(self, kind, job_id):
        msg = self.conn.execute(f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s",
                                (str(job_id),)).fetchone()
        outcome = process_message(PgStore(self.conn), self.reg, Message(msg["msg_id"], kind, {"job_id": str(job_id)}), S)
        return outcome, self.conn.execute("select status, progress, last_error from app.jobs where id = %s",
                                          (job_id,)).fetchone()

    def workspace(self):
        return self.conn.execute("select plan, status from app.workspaces where id = %s", (self.ws,)).fetchone()

    def mirror(self):
        return self.conn.execute("""select stripe_subscription_id, plan, term, status, editor_seats, recipes_included
                                      from app.subscriptions where workspace_id = %s""", (self.ws,)).fetchone()

    def verify(self):
        self.conn.execute("set role anon")     # anyone holding the document: no session, no workspace
        try:
            return self.conn.execute("select public.verify_reference(%s) ->> 'status' as s", (self.ref,)).fetchone()["s"]
        finally:
            self.conn.execute("reset role")


@pytest.fixture
def world():
    conn = connect_or_skip(connect, DSN)
    conn.autocommit = False
    try:
        yield World(conn)
    finally:
        conn.rollback()
        conn.close()


def test_M04_main_webhook_events_are_stored_once_and_drive_the_mirror_through_dunning_and_back(world):
    w = world
    checkout = {"object": "checkout.session", "id": f"cs_{w.tag}", "customer": w.cus, "subscription": w.sub,
                "client_reference_id": w.ws}
    event_id, first = w.deliver("checkout.session.completed", checkout)
    assert first["stored"] is True and first["job_id"]
    again = w.conn.execute("select app.record_stripe_event(%s) as r",
                           (Jsonb({"id": event_id, "object": "event", "type": "checkout.session.completed",
                                   "data": {"object": checkout}}),)).fetchone()["r"]
    assert again == {"stored": False, "duplicate": True}
    assert w.conn.execute("select count(*) as n from app.payment_events where stripe_event_id = %s",
                          (event_id,)).fetchone()["n"] == 1
    assert w.conn.execute("select payload from app.jobs where id = %s", (first["job_id"],)).fetchone()["payload"] == \
        {"stripe_event_id": event_id}

    outcome, job = w.run("billing_sync", first["job_id"])
    assert (outcome, job["status"], job["progress"]) == ("succeeded", "succeeded", {"outcome": "applied"})
    assert w.workspace() == {"plan": "basic", "status": "active"}
    assert w.mirror() == {"stripe_subscription_id": w.sub, "plan": "basic", "term": "monthly", "status": "active",
                          "editor_seats": 3, "recipes_included": 10}

    w.stripe.put(w.subscription("past_due"))   # days 0, 3, 7: dunning, nothing restricted (BE-36)
    _, failed = w.deliver("invoice.payment_failed", {"object": "invoice", "customer": w.cus, "subscription": w.sub})
    assert w.run("billing_sync", failed["job_id"])[0] == "succeeded"
    assert w.workspace() == {"plan": "basic", "status": "dunning"}

    w.stripe.put(w.subscription("active"))
    _, paid = w.deliver("invoice.paid", {"object": "invoice", "customer": w.cus,
                                         "parent": {"subscription_details": {"subscription": w.sub}}})
    assert w.run("billing_sync", paid["job_id"])[0] == "succeeded"
    assert w.workspace() == {"plan": "basic", "status": "active"}


def test_M04_main_daily_reconciliation_repairs_an_event_stripe_gave_up_on(world):
    w = world
    _, created = w.deliver("customer.subscription.created", w.subscription("active"))
    w.run("billing_sync", created["job_id"])
    w.stripe.put(w.subscription("active", plan="standard", addons={"editor_seat": 1}))   # its event never arrived
    job_id = w.conn.execute("select private.enqueue_billing_reconcile() as id").fetchone()["id"]
    assert w.conn.execute("select private.enqueue_billing_reconcile() as id").fetchone()["id"] == job_id  # once a day
    outcome, job = w.run("billing_reconcile", job_id)
    assert outcome == "succeeded" and job["progress"]["applied"] == 1 and job["progress"]["failed"] == 0
    assert w.workspace()["plan"] == "standard" and w.mirror()["editor_seats"] == 6


def test_M04_must_1_cancellation_deletes_nothing_and_verification_still_works(world):
    w = world
    _, created = w.deliver("customer.subscription.created", w.subscription("active"))
    w.run("billing_sync", created["job_id"])
    assert w.verify() == "current"

    w.stripe.put(w.subscription("canceled"))
    _, deleted = w.deliver("customer.subscription.deleted", w.subscription("canceled"))
    assert w.run("billing_sync", deleted["job_id"])[0] == "succeeded"

    assert w.workspace() == {"plan": "free", "status": "active"}
    assert w.mirror()["status"] == "canceled" and w.mirror()["editor_seats"] is None
    assert w.verify() == "current"
    assert w.conn.execute("select count(*) as n from app.payment_events where workspace_id = %s",
                          (w.ws,)).fetchone()["n"] == 2
    with pytest.raises(psycopg.Error, match="insert-only") as exc, w.conn.transaction():
        w.conn.execute("delete from app.payment_events where workspace_id = %s", (w.ws,))
    assert exc.value.sqlstate == "P0005"
    w.conn.execute("update app.workspaces set status = 'closed' where id = %s", (w.ws,))
    assert w.verify() == "current"
