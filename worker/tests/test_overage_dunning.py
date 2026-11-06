"""T-704 units: the BE-34 snapshot amounts, the Stripe client's writes, recipe_overage and dunning against an in-memory
store and Stripe, and the payment_failed email."""
import json
from datetime import UTC, datetime
from typing import Any

import pytest
from billing_fakes import FakeStripe, subscription

from nutrivo_worker import email_templates
from nutrivo_worker import observability as obs
from nutrivo_worker.billing.mirror import snapshot
from nutrivo_worker.billing.stripe import StripeClient, StripeError
from nutrivo_worker.config import Settings
from nutrivo_worker.errors import PermanentJobError
from nutrivo_worker.handlers import billing
from nutrivo_worker.jobs import Job, JobContext
from nutrivo_worker.sources.http import Response

WS = "20000000-0000-4000-8704-00000000000a"


# ── BE-34: the snapshot carries what the cap is checked against, all from Stripe ────────────────────────────────
def test_T704_snapshot_carries_plan_recipes_amounts_and_the_monthly_cap():
    stripe = FakeStripe()
    snap = snapshot(subscription(plan="basic", amounts=True, addons={"recipe": 2, "editor_seat": 1}), stripe.product,
                    stripe.price_by_lookup)
    assert (snap["plan_recipes"], snap["recipes_included"]) == (10, 12)
    assert snap["amount_per_period"] == 24900 + 2 * 1500 + 5000
    assert (snap["recipe_unit_amount"], snap["overage_cap"]) == (1500, 37400)


def test_T704_snapshot_finds_the_recipe_price_by_lookup_key_before_any_recipe_is_bought():
    stripe = FakeStripe()
    snap = snapshot(subscription(plan="standard", amounts=True), stripe.product, stripe.price_by_lookup)
    assert (snap["amount_per_period"], snap["recipe_unit_amount"], snap["overage_cap"]) == (49900, 1200, 74900)


def test_T704_annual_terms_and_unlimited_plans_carry_no_cap_and_unknown_amounts_are_never_guessed():
    stripe = FakeStripe()
    annual = snapshot(subscription(interval="year", amounts=True), stripe.product, stripe.price_by_lookup)
    assert annual["overage_cap"] is None and annual["amount_per_period"] == 249000
    advanced = snapshot(subscription(plan="advanced", amounts=True), stripe.product, stripe.price_by_lookup)
    assert (advanced["plan_recipes"], advanced["recipe_unit_amount"], advanced["overage_cap"]) == (None, None, None)
    unknown = snapshot(subscription(), stripe.product, stripe.price_by_lookup)   # prices without unit_amount
    assert unknown["amount_per_period"] is None


# ── The Stripe client's writes ──────────────────────────────────────────────────────────────────────────────────
class _Transport:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def send(self, method, url, headers, body=None):
        self.calls.append((method, url, dict(headers), body))
        return self.answers.pop(0)


def _ok(body: dict[str, Any], status: int = 200) -> Response:
    return Response(status, {}, json.dumps(body).encode(), "")


def test_T704_stripe_writes_carry_an_idempotency_key_and_a_form_body():
    t = _Transport([_ok({"id": "si_1", "quantity": 3})])
    StripeClient("sk_test_x", env="local", transport=t).set_item_quantity("si_1", 3, idempotency_key="k-1")
    method, url, headers, body = t.calls[0]
    assert (method, url) == ("POST", "https://api.stripe.com/v1/subscription_items/si_1")
    assert headers["Idempotency-Key"] == "k-1"
    assert body == b"quantity=3&proration_behavior=create_prorations"


def test_T704_a_declined_payment_is_an_answer_not_an_error():
    t = _Transport([_ok({"error": {"code": "card_declined", "message": "Your card was declined."}}, 402)])
    answer = StripeClient("sk_test_x", env="local", transport=t).pay_invoice("in_1", idempotency_key="k")
    assert answer == {"declined": True, "code": "card_declined"} and len(t.calls) == 1


def test_T704_a_live_key_never_writes_outside_prod_and_a_live_answer_is_refused():
    t = _Transport([])
    with pytest.raises(StripeError, match="live key may not write"):
        StripeClient("sk_live_x", env="staging", transport=t).pay_invoice("in_1", idempotency_key="k")
    assert t.calls == []
    t = _Transport([_ok({"id": "in_1", "livemode": True})])
    with pytest.raises(StripeError, match="live mode"):
        StripeClient("sk_test_x", env="dev", transport=t).pay_invoice("in_1", idempotency_key="k")


# ── recipe_overage ──────────────────────────────────────────────────────────────────────────────────────────────
class _Store:
    def __init__(self, live_recipes=0, due=(), failing=()):
        self.live_recipes, self.due, self.failing = live_recipes, list(due), set(failing)
        self.applied: list[tuple[str, dict, str, str]] = []
        self.steps: list[tuple[str, str, int, str]] = []
        self.progress: dict[str, Any] = {}

    def recipe_overage_context(self, ws):
        return {"stripe_subscription_id": "sub_A1", "live_recipes": self.live_recipes}

    def apply_subscription(self, ws, snap, source, ref):
        self.applied.append((ws, snap, source, ref))
        return "applied"

    def dunning_due(self):
        return self.due

    def record_dunning_step(self, ws, invoice, day, outcome, ref):
        if invoice in self.failing:
            raise RuntimeError("database said no")
        self.steps.append((ws, invoice, day, outcome))
        return "recorded"

    def heartbeat(self, job_id, progress):
        self.progress.update(progress or {})


def _run(fn, store, stripe, kind="recipe_overage", ws=WS):
    job = Job("job-1", kind, ws, {}, 1)
    return fn(job, JobContext(job, store, Settings()), store, stripe)


def test_T704_C01_must_2_overage_within_the_cap_adds_the_recipe_add_on_and_applies_the_mirror():
    stripe = FakeStripe(subscription(amounts=True, ws=WS))
    store = _Store(live_recipes=12)
    assert _run(billing.recipe_overage, store, stripe) == "raised"
    assert stripe.writes == [("add_item", "sub_A1", 2, "nutrivo-recipe-overage-job-1-0-2")]
    (_, snap, source, _), = store.applied
    assert source == "overage" and snap["recipes_included"] == 12 and snap["amount_per_period"] == 24900 + 3000


def test_T704_C01_must_2_a_repeat_changes_nothing_and_the_add_on_is_never_lowered():
    stripe = FakeStripe(subscription(amounts=True, ws=WS, addons={"recipe": 3}))
    assert _run(billing.recipe_overage, _Store(live_recipes=13), stripe) == "unchanged"
    assert _run(billing.recipe_overage, _Store(live_recipes=11), stripe) == "unchanged"
    assert stripe.writes == []
    assert _run(billing.recipe_overage, _Store(live_recipes=14), stripe) == "raised"
    assert stripe.writes == [("set_item_quantity", "si_recipe", 4, "nutrivo-recipe-overage-job-1-3-4")]


def test_T704_review_4_the_idempotency_key_differs_for_a_new_raise_to_the_same_quantity():
    """Raise to 2, lowered to 1 in the portal, raise to 2 again: a new request, never Stripe's cached answer."""
    stripe = FakeStripe(subscription(amounts=True, ws=WS, addons={"recipe": 1}))
    store = _Store(live_recipes=12)
    job = Job("job-2", "recipe_overage", WS, {}, 1)
    billing.recipe_overage(job, JobContext(job, store, Settings()), store, stripe)
    assert stripe.writes[-1][3] == "nutrivo-recipe-overage-job-2-1-2"
    assert stripe.writes[-1][3] != "nutrivo-recipe-overage-job-1-1-2"


def test_T704_C01_fail_1_past_the_cap_nothing_is_charged_and_the_job_fails_visibly():
    stripe = FakeStripe(subscription(amounts=True, ws=WS))
    with pytest.raises(PermanentJobError, match="over the cap 37400: nothing charged"):
        _run(billing.recipe_overage, _Store(live_recipes=19), stripe)   # 24900 + 9 × 1500 = 38400
    assert stripe.writes == []


def test_T704_C01_fail_1_an_annual_or_unpaid_subscription_is_never_charged_overage():
    annual = FakeStripe(subscription(amounts=True, ws=WS, interval="year"))
    with pytest.raises(PermanentJobError, match="takes no overage"):
        _run(billing.recipe_overage, _Store(live_recipes=11), annual)
    past_due = FakeStripe(subscription(amounts=True, ws=WS, status="past_due"))
    with pytest.raises(PermanentJobError, match="past_due: recipe overage not charged"):
        _run(billing.recipe_overage, _Store(live_recipes=11), past_due)   # visible, never a quiet success
    assert annual.writes == [] and past_due.writes == []


# ── dunning ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _due(invoice, day):
    return {"workspace_id": WS, "stripe_invoice_id": invoice, "day": day, "failed_at": datetime.now(UTC)}


@pytest.fixture
def checkins(monkeypatch):
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(obs.crons, "capture_checkin",
                        lambda monitor_slug, status, monitor_config=None, check_in_id=None:
                        seen.append((monitor_slug, status)) or "ci-1")
    return seen


def test_T704_M04_main_days_0_3_7_14_notify_and_3_and_7_retry_inside_the_cron_check_in(checkins):
    stripe = FakeStripe()
    stripe.invoices = {i: {"id": i, "status": "open"} for i in ("in_0", "in_3", "in_7", "in_14")}
    store = _Store(due=[_due("in_0", 0), _due("in_3", 3), _due("in_7", 7), _due("in_14", 14)])
    counts = _run(billing.dunning, store, stripe, kind="dunning", ws=None)
    assert counts == {"notified": 4, "resolved": 0, "duplicate": 0, "failed": 0}
    assert [s[2:] for s in store.steps] == [(0, "notified"), (3, "notified"), (7, "notified"), (14, "notified")]
    assert [(w[0], w[1], w[3]) for w in stripe.writes] == [("pay_invoice", "in_3", "nutrivo-dunning-in_3-3"),
                                                           ("pay_invoice", "in_7", "nutrivo-dunning-in_7-7")]
    assert checkins == [("dunning", "in_progress"), ("dunning", "ok")]


def test_T704_M04_main_a_paid_invoice_or_a_successful_retry_ends_the_schedule(checkins):
    stripe = FakeStripe()
    stripe.invoices = {"in_paid": {"id": "in_paid", "status": "paid"}, "in_retry": {"id": "in_retry", "status": "open"}}
    stripe.pay_succeeds = {"in_retry"}
    store = _Store(due=[_due("in_paid", 7), _due("in_retry", 3)])
    assert _run(billing.dunning, store, stripe, kind="dunning", ws=None)["resolved"] == 2
    assert [s[3] for s in store.steps] == ["resolved", "resolved"]
    assert [w[1] for w in stripe.writes] == ["in_retry"]    # a paid invoice is never charged again


def test_T704_review_5_a_retry_that_errors_still_records_the_day_and_sends_its_notice(checkins, monkeypatch):
    errors: list[BaseException] = []
    monkeypatch.setattr(billing.sentry_sdk, "capture_exception", errors.append)
    stripe = FakeStripe()
    stripe.invoices = {"in_3": {"id": "in_3", "status": "open"}}

    def broken(invoice_id, *, idempotency_key):
        raise RuntimeError("Stripe 500")
    stripe.pay_invoice = broken
    store = _Store(due=[_due("in_3", 3)])
    assert _run(billing.dunning, store, stripe, kind="dunning", ws=None)["notified"] == 1
    assert store.steps == [(WS, "in_3", 3, "notified")] and len(errors) == 1


def test_T704_M04_main_one_failing_invoice_never_stops_the_others_but_fails_the_run(checkins):
    stripe = FakeStripe()
    stripe.invoices = {"in_a": {"id": "in_a", "status": "open"}, "in_b": {"id": "in_b", "status": "open"}}
    store = _Store(due=[_due("in_a", 0), _due("in_b", 0)], failing={"in_a"})
    with pytest.raises(billing.DunningIncomplete, match="1 dunning steps"):
        _run(billing.dunning, store, stripe, kind="dunning", ws=None)
    assert [s[1] for s in store.steps] == ["in_b"]
    assert checkins[-1] == ("dunning", "error")


# ── the payment_failed email ────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("day", [0, 3, 7, 14])
def test_T704_M04_must_1_every_dunning_email_says_nothing_is_deleted_and_reports_stay_verifiable(day):
    email = email_templates.payment_failed(to="finance@halden.test", day=day, amount_cents=29880,
                                           invoice_number="NV-0042", url="https://app.test/w/x/settings/billing/payment",
                                           stopped=day == 14)
    assert "€298.80" in email.subject and "NV-0042" in email.subject
    assert "never deletes anything and never makes a report unverifiable" in email.text
    if day == 14:
        assert "stopped accepting new labels" in email.text and "every report already sent stays verifiable" in email.text
    else:
        assert "stopped accepting" not in email.text


def test_T704_review_6_the_day_14_email_claims_a_stop_only_when_there_was_one():
    email = email_templates.payment_failed(to="f@h.test", day=14, amount_cents=100, invoice_number="NV-1", url="u")
    assert "paused" not in email.subject and "stopped accepting" not in email.text
    assert "still unpaid" in email.subject.lower() and "Nothing changes in the product." in email.text


# ── review 1: billing_sync and billing_reconcile mirror the recipe price before any recipe is bought ───────────────
class _SyncStore(_Store):
    def __init__(self):
        super().__init__()
        self.event = {"workspace_id": WS, "type": "customer.subscription.created",
                      "payload": {"id": "evt_1", "data": {"object": {"object": "subscription", "id": "sub_A1"}}}}

    def payment_event(self, stripe_event_id):
        return self.event

    def workspace_for_subscription(self, sub):
        return WS


def test_T704_review_1_sync_and_reconcile_mirror_the_recipe_unit_amount_without_a_recipe_item(checkins):
    stripe = FakeStripe(subscription(amounts=True, ws=WS))      # no recipe add-on item yet, as after checkout
    store = _SyncStore()
    job = Job("job-s", "billing_sync", WS, {"stripe_event_id": "evt_1"}, 1)
    billing.sync(job, JobContext(job, store, Settings()), store, stripe)
    job = Job("job-r", "billing_reconcile", None, {}, 1)
    billing.reconcile(job, JobContext(job, store, Settings()), store, stripe)
    assert [a[1]["recipe_unit_amount"] for a in store.applied] == [1500, 1500]
    assert [a[1]["overage_cap"] for a in store.applied] == [37400, 37400]
