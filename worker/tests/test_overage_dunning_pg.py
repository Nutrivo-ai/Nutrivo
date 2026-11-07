"""T-704 end to end on the local stack: BE-34 overage through app.create_product, the recipe_overage job and the mirror;
BE-36 dunning from a stored invoice.payment_failed event through the daily dunning job, the payment_failed email
and day 14, with public.verify_reference still current. Stripe is in memory (test mode only, never a network call).

Each test runs in one transaction that is rolled back (payment_events and dunning_steps are insert-only). Locally the
tests skip without the stack; CI's worker job fails such a skip (tests/pgtest.py)."""
import time
import uuid

import psycopg
import pytest
from billing_fakes import FakeStripe, subscription
from fakes import FakeMailer
from pgtest import DSN, connect_or_skip
from psycopg.types.json import Jsonb

from nutrivo_worker import mail
from nutrivo_worker import observability as obs
from nutrivo_worker.config import Settings
from nutrivo_worker.db import PgStore, connect
from nutrivo_worker.handlers import billing, notify
from nutrivo_worker.jobs import Message, Registry, process_message

S = Settings(max_attempts=5, app_base_url="https://app.nutrivo.test")


class World:
    """Workspace W on Basic monthly (10 recipes, €249, cap €374), Owen its admin, one issued report somebody holds."""

    def __init__(self, conn):
        self.conn, self.tag = conn, uuid.uuid4().hex[:12]
        self.ws, self.user, self.person, fam, product = (str(uuid.uuid4()) for _ in range(5))
        self.sub, self.cus = f"sub_{self.tag}", f"cus_{self.tag}"
        self.ref = f"nv-t704-{self.tag}-000000"
        conn.execute("insert into auth.users (id, email) values (%s, %s)", (self.user, f"owen-{self.tag}@w.test"))
        conn.execute("insert into app.people (id, user_id, display_name, email) values (%s, %s, 'Owen', %s)",
                     (self.person, self.user, f"owen-{self.tag}@w.test"))
        conn.execute("""insert into app.workspaces (id, name, plan, status, entitled_regions)
                        values (%s, 'Halden Pet Nutrition', 'basic', 'active', '{EU}')""", (self.ws,))
        conn.execute("insert into app.allowances (workspace_id) values (%s)", (self.ws,))
        conn.execute("insert into app.memberships (workspace_id, person_id, role) values (%s, %s, 'admin')",
                     (self.ws, self.person))
        conn.execute("insert into app.families (id, workspace_id, name) values (%s, %s, 'Senior range')", (fam, self.ws))
        conn.execute("insert into app.products (id, workspace_id, family_id, name) values (%s, %s, %s, 'Senior dry')",
                     (product, self.ws, fam))
        conn.execute("""insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version,
                                                 artwork_sha, has_not_assessed)
                        values (%s, %s, 'EU-SE', %s, '{}', '0000.00-empty', 'sha-t704', true)""",
                     (self.ws, product, self.ref))
        self.stripe = FakeStripe(subscription(self.sub, ws=self.ws, customer=self.cus, amounts=True))
        self.mailer = FakeMailer()
        self.reg = Registry()
        self.reg.register("recipe_overage")(lambda j, ctx: billing.recipe_overage(j, ctx, ctx.store, self.stripe))
        self.reg.register("dunning")(lambda j, ctx: billing.dunning(j, ctx, ctx.store, self.stripe))
        self.reg.register("notify")(
            lambda j, ctx: notify.send_payment_failed(j, ctx, ctx.store, self.mailer))
        # The mirror as billing_sync leaves it, BE-34 amounts included.
        snap = billing.snapshot(self.stripe.subscription(self.sub), self.stripe.product, self.stripe.price_by_lookup)
        assert PgStore(conn).apply_subscription(self.ws, snap, "webhook", "setup") == "applied"

    def run(self, kind, job_id):
        msg = self.conn.execute(f"select msg_id from pgmq.q_{kind} where message->>'job_id' = %s",
                                (str(job_id),)).fetchone()
        outcome = process_message(PgStore(self.conn), self.reg, Message(msg["msg_id"], kind, {"job_id": str(job_id)}), S)
        return outcome, self.conn.execute("select status, progress, last_error from app.jobs where id = %s",
                                          (job_id,)).fetchone()

    def as_owen(self, sql, params=()):
        self.conn.execute("select set_config('request.jwt.claims', %s, true)",
                          (f'{{"sub":"{self.user}","role":"authenticated"}}',))
        self.conn.execute("set role authenticated")
        try:
            return self.conn.execute(sql, params).fetchone()
        finally:
            if self.conn.info.transaction_status != psycopg.pq.TransactionStatus.INERROR:   # else the savepoint undoes it
                self.conn.execute("reset role")
                self.conn.execute("select set_config('request.jwt.claims', '', true)")   # the worker has no session

    def new_recipe(self, n):
        return self.as_owen("select app.create_product(%s, %s, null, %s) as id", (self.ws, f"P{n}", f"Recipe {n}"))

    def jobs(self, kind):
        return [r["id"] for r in self.conn.execute(
            "select id from app.jobs where workspace_id = %s and kind = %s order by created_at, id",
            (self.ws, kind)).fetchall()]

    def mirror(self):
        return self.conn.execute("""select recipes_included, amount_per_period from app.subscriptions
                                     where workspace_id = %s""", (self.ws,)).fetchone()

    def status(self):
        return self.conn.execute("select status from app.workspaces where id = %s", (self.ws,)).fetchone()["status"]

    def verify(self):
        self.conn.execute("set role anon")
        try:
            return self.conn.execute("select public.verify_reference(%s) ->> 'status' as s", (self.ref,)).fetchone()["s"]
        finally:
            self.conn.execute("reset role")

    def past_due(self):
        """What billing_sync does with Stripe's past_due subscription: the mirror and the workspace enter dunning."""
        self.stripe.put(subscription(self.sub, ws=self.ws, customer=self.cus, status="past_due", amounts=True))
        snap = billing.snapshot(self.stripe.subscription(self.sub), self.stripe.product, self.stripe.price_by_lookup)
        assert PgStore(self.conn).apply_subscription(self.ws, snap, "webhook", "past_due") == "applied"
        assert self.status() == "dunning"

    def payment_failed(self, invoice, days_ago):
        event = {"id": f"evt_{self.tag}_{invoice}", "object": "event", "type": "invoice.payment_failed",
                 "livemode": False, "created": int(time.time()) - days_ago * 86400,
                 "data": {"object": {"id": invoice, "object": "invoice", "customer": self.cus, "subscription": self.sub,
                                     "number": "NV-0042", "currency": "eur", "amount_due": 29880,
                                     "customer_email": "finance@halden.test", "status": "open"}}}
        self.conn.execute("select app.record_stripe_event(%s)", (Jsonb(event),))
        self.stripe.invoices[invoice] = {"id": invoice, "status": "open"}


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setattr(obs.crons, "capture_checkin", lambda **kw: "ci-1")
    monkeypatch.setattr(mail, "mailer_for", lambda settings: pytest.fail("the test's FakeMailer must be used"))
    conn = connect_or_skip(connect, DSN)
    conn.autocommit = False
    try:
        yield World(conn)
    finally:
        conn.rollback()
        conn.close()


def test_T704_C01_must_2_overage_within_the_cap_is_charged_in_stripe_and_mirrored(world):
    w = world
    for n in range(2, 11):                         # the family above plus nine: all ten paid recipes
        w.new_recipe(n)
    assert w.jobs("recipe_overage") == []
    w.new_recipe(11)                               # the first recipe of overage: €249 + €15 ≤ €374
    (job_id,) = w.jobs("recipe_overage")
    outcome, job = w.run("recipe_overage", job_id)
    assert (outcome, job["progress"]["outcome"]) == ("succeeded", "raised")
    assert w.stripe.writes == [("add_item", w.sub, 1, f"nutrivo-recipe-overage-{job_id}-0-1")]
    assert w.mirror() == {"recipes_included": 11, "amount_per_period": 24900 + 1500}
    again = w.conn.execute("select private.enqueue('recipe_overage', %s, %s, '{}') as id",
                           (w.ws, f"again-{w.tag}")).fetchone()["id"]
    outcome, job = w.run("recipe_overage", again)                     # a second job for the same count
    assert (outcome, job["progress"]["outcome"]) == ("succeeded", "unchanged")
    assert len(w.stripe.writes) == 1                                  # nothing more charged


def test_T704_C01_fail_1_past_the_cap_the_next_plan_is_offered_and_nothing_is_charged(world):
    w = world
    for n in range(2, 19):                         # 18 recipes: €249 + 8 × €15 = €369, the last that fits
        w.new_recipe(n)
    with pytest.raises(psycopg.Error) as exc, w.conn.transaction():
        w.new_recipe(19)                           # €384 would pass €374
    assert exc.value.sqlstate == "P0034" and '"next_plan": "standard"' in (exc.value.diag.message_hint or "")
    assert w.conn.execute("select count(*) as n from app.families where workspace_id = %s",
                          (w.ws,)).fetchone()["n"] == 18
    assert w.stripe.writes == []


def test_T704_M04_main_dunning_runs_daily_notifies_and_stops_new_artworks_on_day_14(world):
    w = world
    w.past_due()
    w.payment_failed("in_late", 15)
    w.payment_failed("in_new", 0)
    job_id = w.conn.execute("select private.enqueue_dunning() as id").fetchone()["id"]
    assert w.conn.execute("select private.enqueue_dunning() as id").fetchone()["id"] == job_id   # once a day
    assert w.conn.execute("select payload from app.jobs where id = %s", (job_id,)).fetchone()["payload"] == {}
    outcome, job = w.run("dunning", job_id)
    assert outcome == "succeeded" and job["progress"]["notified"] == 2
    assert w.status() == "new_artwork_stopped"
    days = w.conn.execute("""select stripe_invoice_id, day from app.dunning_steps where workspace_id = %s
                              order by day""", (w.ws,)).fetchall()
    assert [(d["stripe_invoice_id"], d["day"]) for d in days] == [("in_new", 0), ("in_late", 14)]

    for notify_job in w.jobs("notify"):
        assert w.run("notify", notify_job)[0] == "succeeded"
    assert sorted(e.subject for e in w.mailer.sent) == [
        "A payment failed: Nutrivo invoice NV-0042, €298.80",
        "New labels are paused: Nutrivo invoice NV-0042, €298.80"]
    assert {e.to for e in w.mailer.sent} == {"finance@halden.test"}


def test_T704_M04_must_1_dunning_and_cancellation_delete_nothing_and_verification_never_breaks(world):
    w = world
    assert w.verify() == "current"
    w.past_due()
    w.payment_failed("in_late", 15)
    w.run("dunning", w.conn.execute("select private.enqueue_dunning() as id").fetchone()["id"])
    assert w.status() == "new_artwork_stopped" and w.verify() == "current"
    w.stripe.put(subscription(w.sub, ws=w.ws, customer=w.cus, status="canceled", amounts=True))
    snap = billing.snapshot(w.stripe.subscription(w.sub), w.stripe.product, w.stripe.price_by_lookup)
    PgStore(w.conn).apply_subscription(w.ws, snap, "webhook", "cancel")
    w.conn.execute("update app.workspaces set status = 'closed' where id = %s", (w.ws,))
    assert w.verify() == "current"
    assert w.conn.execute("select count(*) as n from app.reports where workspace_id = %s", (w.ws,)).fetchone()["n"] == 1
    with pytest.raises(psycopg.Error) as exc, w.conn.transaction():
        w.conn.execute("delete from app.dunning_steps where workspace_id = %s", (w.ws,))
    assert exc.value.sqlstate == "P0005"
