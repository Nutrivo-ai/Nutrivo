"""T-702 units: the subscription snapshot, the read-only Stripe client, the handlers against an in-memory store."""
import json
from typing import Any

import pytest
from billing_fakes import FakeStripe, subscription

from nutrivo_worker import observability as obs
from nutrivo_worker.billing.mirror import NotNutrivo, snapshot, subscription_id_of, workspace_id
from nutrivo_worker.billing.stripe import StripeClient, StripeError
from nutrivo_worker.config import ConfigError, Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.handlers import billing
from nutrivo_worker.jobs import Job, JobContext
from nutrivo_worker.sources.http import Response, TransportError

WS = "20000000-0000-4000-8702-00000000000a"


def test_snapshot_maps_plan_term_dials_and_add_ons():
    stripe = FakeStripe()
    snap = snapshot(subscription(plan="standard", interval="year", addons={"editor_seat": 2, "recipe": 5, "region": 1}),
                    stripe.product)
    assert snap == {"customer_id": "cus_A", "subscription_id": "sub_A1", "plan": "standard", "term": "annual",
                    "status": "active", "editor_seats": 7, "recipes_included": 35,
                    "current_period_end": "2027-01-15T08:00:00+00:00"}


def test_snapshot_unlimited_dials_mean_no_check_and_products_are_read_once_per_run():
    stripe = FakeStripe()
    snap = snapshot(subscription(plan="advanced"), stripe.product)
    assert snap["editor_seats"] is None and snap["recipes_included"] is None
    client = StripeClient("sk_test_x", env="local", transport=_Transport([_ok({"id": "p", "metadata": {}})]))
    client.product("p")
    client.product("p")
    assert len(client.transport.calls) == 1


def test_a_subscription_without_exactly_one_nutrivo_plan_is_not_applied():
    sub = subscription()
    sub["items"]["data"][0]["price"]["metadata"] = {}
    with pytest.raises(NotNutrivo):
        snapshot(sub, FakeStripe().product)


def test_subscription_and_workspace_ids_are_read_from_every_webhook_object_shape():
    assert subscription_id_of({"object": "subscription", "id": "sub_1"}) == "sub_1"
    assert subscription_id_of({"object": "checkout.session", "subscription": "sub_2"}) == "sub_2"
    assert subscription_id_of({"object": "invoice", "subscription": None,
                               "parent": {"subscription_details": {"subscription": "sub_3"}}}) == "sub_3"
    assert subscription_id_of({"object": "checkout.session", "mode": "payment"}) is None
    assert workspace_id(subscription(ws=WS.upper())) == WS
    assert workspace_id({"metadata": {"workspace_id": "x'; drop table"}}) is None


# ── the Stripe client ────────────────────────────────────────────────────────────────────────────────────────
def _ok(body: dict[str, Any]) -> Response:
    return Response(200, {}, json.dumps(body).encode(), "")


class _Transport:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def send(self, method, url, headers, body=None):
        self.calls.append((method, url, dict(headers)))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_stripe_client_retries_transient_errors_a_bounded_number_of_times():
    sleeps: list[float] = []
    t = _Transport([Response(429, {}, b"", ""), TransportError("URLError"), _ok({"id": "sub_1"})])
    assert StripeClient("sk_test_x", env="local", transport=t, sleep=sleeps.append).subscription("sub_1")["id"] == "sub_1"
    assert sleeps == [1, 2]
    t = _Transport([Response(503, {}, b"", "")] * 3)
    with pytest.raises(StripeError, match="after 3 attempts: HTTP 503"):
        StripeClient("sk_test_x", env="local", transport=t, sleep=lambda s: None).subscription("sub_1")


def test_stripe_client_fails_at_once_on_a_client_error_and_never_puts_the_key_in_the_error():
    t = _Transport([Response(401, {}, b'{"error":{"message":"Invalid API Key provided: sk_test_x"}}', "")])
    with pytest.raises(StripeError) as exc:
        StripeClient("sk_test_secret", env="local", transport=t).subscription("sub_1")
    assert "sk_test" not in str(exc.value) and len(t.calls) == 1
    assert t.calls[0][2]["Authorization"] == "Bearer sk_test_secret"


def test_stripe_client_pages_through_every_subscription():
    t = _Transport([_ok({"data": [{"id": "sub_1"}, {"id": "sub_2"}], "has_more": True}),
                    _ok({"data": [{"id": "sub_3"}], "has_more": False})])
    assert [s["id"] for s in StripeClient("sk_test_x", env="local", transport=t).subscriptions()] == ["sub_1", "sub_2",
                                                                                                       "sub_3"]
    assert "starting_after=sub_2" in t.calls[1][1] and "status=all" in t.calls[0][1]


def test_live_mode_is_refused_outside_prod():
    t = _Transport([_ok({"id": "sub_1", "livemode": True})])
    with pytest.raises(StripeError, match="live mode"):
        StripeClient("sk_test_x", env="staging", transport=t).subscription("sub_1")
    with pytest.raises(ConfigError, match="live Stripe key"):
        Settings.from_env({"NUTRIVO_ENV": "staging", "STRIPE_SECRET_KEY": "sk_live_abc"})
    assert Settings.from_env({"NUTRIVO_ENV": "prod", "STRIPE_SECRET_KEY": "sk_live_abc"}).require_stripe()
    with pytest.raises(PermanentJobError, match="STRIPE_SECRET_KEY"):
        billing.stripe_client(JobContext(_job("billing_sync", {}), _Store(), Settings()))


# ── the handlers ─────────────────────────────────────────────────────────────────────────────────────────────
class _Store:
    def __init__(self, events=None, ws_by_sub=None, fail_for=()):
        self.events, self.ws_by_sub, self.fail_for = events or {}, ws_by_sub or {}, set(fail_for)
        self.applied: list[tuple[str, dict, str, str]] = []
        self.progress: dict[str, Any] = {}

    def payment_event(self, stripe_event_id):
        return self.events.get(stripe_event_id)

    def workspace_for_subscription(self, sub):
        return self.ws_by_sub.get(sub["id"]) or workspace_id(sub)

    def apply_subscription(self, ws, snap, source, ref):
        if snap["subscription_id"] in self.fail_for:
            raise RuntimeError("database said no")
        self.applied.append((ws, snap, source, ref))
        return "applied"

    def heartbeat(self, job_id, progress):
        self.progress.update(progress or {})


def _job(kind, payload, job_id="job-1"):
    return Job(job_id, kind, None, payload, 1)


def _ctx(store, job):
    return JobContext(job, store, Settings())


def _event(event_type, obj, ws=None):
    return {"workspace_id": ws, "type": event_type, "payload": {"id": "evt_1", "data": {"object": obj}}}


def test_sync_rereads_the_subscription_from_stripe_and_applies_it():
    store = _Store({"evt_1": _event("invoice.payment_failed", {"object": "invoice", "subscription": "sub_A1"}, WS)})
    job = _job("billing_sync", {"stripe_event_id": "evt_1"})
    assert billing.sync(job, _ctx(store, job), store, FakeStripe(subscription(status="past_due"))) == "applied"
    [(ws, snap, source, ref)] = store.applied
    assert (ws, snap["status"], source, ref) == (WS, "past_due", "webhook", "evt_1")


def test_sync_without_a_subscription_is_a_recorded_no_op_and_without_a_workspace_fails_permanently():
    store = _Store({"evt_1": _event("checkout.session.completed", {"object": "checkout.session", "mode": "payment"})})
    job = _job("billing_sync", {"stripe_event_id": "evt_1"})
    assert billing.sync(job, _ctx(store, job), store, FakeStripe()) == "no_subscription" and not store.applied
    store = _Store({"evt_1": _event("invoice.paid", {"object": "invoice", "subscription": "sub_A1"})})
    with pytest.raises(PermanentJobError, match="no workspace for subscription sub_A1"):
        billing.sync(job, _ctx(store, job), store, FakeStripe(subscription()))
    for payload in ({}, {"stripe_event_id": "nope"}, {"stripe_event_id": "evt_missing"}):
        with pytest.raises(PermanentJobError):
            billing.sync(_job("billing_sync", payload), _ctx(store, job), store, FakeStripe())


def test_reconcile_applies_every_nutrivo_subscription_and_reports_to_its_cron_monitor(monkeypatch):
    checkins: list[tuple[str, str, Any]] = []
    alerts: list[str] = []
    monkeypatch.setattr(billing.sentry_sdk, "capture_message", lambda message, level=None: alerts.append(message))
    monkeypatch.setattr(obs.crons, "capture_checkin",
                        lambda monitor_slug, status, monitor_config=None, check_in_id=None:
                        checkins.append((monitor_slug, status, monitor_config)) or "ci-1")
    foreign = subscription("sub_X")
    foreign["items"]["data"][0]["price"]["metadata"] = {}
    stripe = FakeStripe(subscription("sub_A1", ws=WS), subscription("sub_B1"), subscription("sub_C1"), foreign)
    store = _Store(ws_by_sub={"sub_B1": "20000000-0000-4000-8702-00000000000b"})
    job = _job("billing_reconcile", {})
    counts = billing.reconcile(job, _ctx(store, job), store, stripe)
    assert counts == {"applied": 2, "unchanged": 0, "stale": 0, "not_nutrivo": 1, "unattributed": 1, "failed": 0}
    assert [a[2] for a in store.applied] == ["reconcile", "reconcile"]
    assert [(c[0], c[1]) for c in checkins] == [("stripe-reconcile", "in_progress"), ("stripe-reconcile", "ok")]
    assert checkins[0][2]["schedule"]["value"] == "17 3 * * *"
    assert alerts == ["subscription sub_C1 names no Nutrivo workspace", "stripe reconciliation corrected 2 subscriptions"]


def test_reconcile_applies_the_rest_then_fails_the_run_when_one_subscription_cannot_be_applied(monkeypatch):
    checkins: list[str] = []
    monkeypatch.setattr(obs.crons, "capture_checkin",
                        lambda monitor_slug, status, monitor_config=None, check_in_id=None: checkins.append(status))
    store = _Store(fail_for={"sub_A1"})
    job = _job("billing_reconcile", {})
    with pytest.raises(billing.ReconcileIncomplete, match="1 subscriptions"):
        billing.reconcile(job, _ctx(store, job), store,
                          FakeStripe(subscription("sub_A1", ws=WS),
                                     subscription("sub_B1", ws="20000000-0000-4000-8702-00000000000b")))
    assert len(store.applied) == 1 and checkins == ["in_progress", "error"]
