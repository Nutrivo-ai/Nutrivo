"""billing_sync and billing_reconcile (T-702, M04, docs/08 §Webhooks): Stripe subscriptions onto app.subscriptions and
app.workspaces.plan / status, through app.apply_subscription. Stripe is the source of truth (D-18).

billing_sync · payload {"stripe_event_id"}: ids only. The stripe-webhook Edge Function stored the event and queued
  this job (app.record_stripe_event). The job re-reads the event's subscription from Stripe rather than trusting the
  event body, so events delivered out of order or twice all converge on Stripe's current state. An event about no
  subscription (a one-off checkout) is a recorded no-op; one whose workspace cannot be found fails permanently, which
  shows in app.jobs and Sentry while the event itself stays stored.
billing_reconcile · payload {}: once a day (pg_cron, 03:17 UTC), every subscription in Stripe is applied the same way,
  which repairs a delivery Stripe gave up on or a job that failed. It runs inside the Sentry cron check-in
  'stripe-reconcile' (docs/17). Any correction it makes is reported to Sentry as a warning, because it means a
  webhook was missed (docs/18); a subscription that cannot be applied fails the run after the others are applied, so the job
  retries (bounded by max_attempts) and the check-in reports the error.

recipe_overage · payload {} (T-704, BE-34): queued by private.require_recipe_room when a new recipe on a monthly
  Basic or Standard plan fits within the 1.5x cap. It re-reads the subscription from Stripe, checks the cap again
  against Stripe's own amounts, raises the recipe add-on to what the live recipes need (never lowers it, #65 Q4),
  and applies the mirror. Over the cap it fails permanently and charges nothing. Idempotent: it sets a quantity,
  with an Idempotency-Key per subscription and quantity, so a repeat changes nothing.
dunning · payload {} (T-704, BE-36): once a day (pg_cron, 07:41 UTC), inside the Sentry cron check-in 'dunning'
  (docs/17). For each step app.dunning_due returns it re-reads the invoice from Stripe: an invoice that no
  longer needs paying is recorded 'resolved'; otherwise days 3 and 7 retry the payment (a decline is the expected
  answer; a success is 'resolved'), and the step is recorded 'notified', which queues the payment_failed email and,
  on day 14, stops new artworks. One invoice that fails never stops the others; the run then fails and retries
  (bounded by max_attempts), and every step already recorded stays recorded.

None of these touches reports, supersessions or public.verify_reference: verification outlives the subscription
(BE-36, CLAUDE.md non-negotiable 9)."""
from __future__ import annotations

import re
from typing import Any, Protocol

import sentry_sdk

from .. import observability as obs
from ..billing.mirror import NotNutrivo, recipe_item, recipe_lookup_key, snapshot, subscription_id_of
from ..billing.stripe import StripeClient
from ..config import ConfigError
from ..errors import PermanentJobError, SafeError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv

log = get_logger(__name__)

EVENT_ID = re.compile(r"^evt_[A-Za-z0-9_]{1,250}$")


class BillingStore(Protocol):
    def payment_event(self, stripe_event_id: str) -> dict[str, Any] | None: ...
    def workspace_for_subscription(self, sub: dict[str, Any]) -> str | None: ...
    def apply_subscription(self, workspace_id: str, snapshot: dict[str, Any], source: str, ref: str) -> str: ...


    def recipe_overage_context(self, workspace_id: str) -> dict[str, Any] | None: ...
    def dunning_due(self) -> list[dict[str, Any]]: ...
    def record_dunning_step(self, workspace_id: str, invoice_id: str, day: int, outcome: str, ref: str) -> str: ...


class Stripe(Protocol):
    def subscription(self, subscription_id: str) -> dict[str, Any]: ...
    def subscriptions(self) -> Any: ...
    def product(self, product_id: str) -> dict[str, Any]: ...
    def price_by_lookup(self, lookup_key: str) -> dict[str, Any] | None: ...
    def invoice(self, invoice_id: str) -> dict[str, Any]: ...
    def pay_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict[str, Any]: ...
    def set_item_quantity(self, item_id: str, quantity: int, *, idempotency_key: str) -> dict[str, Any]: ...
    def add_item(self, subscription_id: str, price_id: str, quantity: int, *, idempotency_key: str) -> dict[str, Any]: ...


class ReconcileIncomplete(SafeError):
    """Some subscriptions could not be applied; the others were."""


class DunningIncomplete(SafeError):
    """Some dunning steps could not be taken; the others were recorded."""


def stripe_client(ctx: JobContext) -> StripeClient:
    try:
        key = ctx.settings.require_stripe()
    except ConfigError as exc:
        raise PermanentJobError(str(exc)) from None
    return StripeClient(key, env=ctx.settings.env)


def _workspace(store: BillingStore, sub: dict[str, Any], known: str | None) -> str | None:
    """A subscription already mirrored keeps its workspace whatever its metadata says (the database decides, the same
    way it attributes events); only then the event's own workspace (a checkout session's client_reference_id)."""
    return store.workspace_for_subscription(sub) or known


def sync(job: Job, ctx: JobContext, store: BillingStore, stripe: Stripe) -> str:
    event_id = str(job.payload.get("stripe_event_id") or "")
    if not EVENT_ID.match(event_id):
        raise PermanentJobError("payload stripe_event_id is not a Stripe event id")
    event = store.payment_event(event_id)
    if event is None:
        raise PermanentJobError(f"payment event {event_id} does not exist")
    obj = (event["payload"].get("data") or {}).get("object") or {}
    sub_id = subscription_id_of(obj)
    if sub_id is None:
        outcome = "no_subscription"
    else:
        sub = stripe.subscription(sub_id)
        ws = _workspace(store, sub, event["workspace_id"])
        if ws is None:
            raise PermanentJobError(f"no workspace for subscription {sub_id} (event {event_id})")
        try:
            snap = snapshot(sub, stripe.product, stripe.price_by_lookup)
        except NotNutrivo as exc:
            raise PermanentJobError(str(exc)) from None
        outcome = store.apply_subscription(ws, snap, "webhook", event_id)
    ctx.heartbeat(outcome=outcome)
    log.info("billing_sync finished", extra=kv(stripe_event_id=event_id, event_type=event["type"], outcome=outcome))
    return outcome


def reconcile(job: Job, ctx: JobContext, store: BillingStore, stripe: Stripe) -> dict[str, int]:
    counts = {"applied": 0, "unchanged": 0, "stale": 0, "not_nutrivo": 0, "unattributed": 0, "failed": 0}
    with obs.cron_checkin(obs.BILLING_RECONCILE_MONITOR, obs.BILLING_RECONCILE_CONFIG):
        for sub in stripe.subscriptions():
            try:
                snap = snapshot(sub, stripe.product, stripe.price_by_lookup)
            except NotNutrivo:
                counts["not_nutrivo"] += 1
                continue
            ws = _workspace(store, sub, None)
            if ws is None:
                counts["unattributed"] += 1
                with sentry_sdk.isolation_scope() as scope:
                    scope.set_tag("stripe_subscription_id", sub["id"])
                    sentry_sdk.capture_message(f"subscription {sub['id']} names no Nutrivo workspace", level="warning")
                continue
            try:
                counts[store.apply_subscription(ws, snap, "reconcile", job.id)] += 1
            except Exception as exc:     # one bad row never stops the others; the run still ends in error
                counts["failed"] += 1
                sentry_sdk.capture_exception(exc)
                log.error("billing_reconcile could not apply a subscription", exc_info=exc,
                          extra=kv(stripe_subscription_id=sub["id"]))
            ctx.heartbeat(**counts)
        ctx.heartbeat(**counts)
        log.info("billing_reconcile finished", extra=kv(**counts))
        if counts["applied"]:
            sentry_sdk.capture_message(f"stripe reconciliation corrected {counts['applied']} subscriptions",
                                       level="warning")
        if counts["failed"]:
            raise ReconcileIncomplete(f"{counts['failed']} subscriptions could not be applied")
    return counts


LIVE = ("active", "trialing")
SETTLED = ("paid", "void", "uncollectible")


def recipe_overage(job: Job, ctx: JobContext, store: BillingStore, stripe: Stripe) -> str:
    ws = job.workspace_id
    if not ws:
        raise PermanentJobError("the job names no workspace")
    context = store.recipe_overage_context(ws)
    sub_id = (context or {}).get("stripe_subscription_id")
    if not sub_id:
        raise PermanentJobError("the workspace has no mirrored subscription")
    sub = stripe.subscription(sub_id)
    try:
        snap = snapshot(sub, stripe.product, stripe.price_by_lookup)
    except NotNutrivo as exc:
        raise PermanentJobError(str(exc)) from None
    item = recipe_item(sub)
    current = int(item.get("quantity") or 0) if item else 0
    need = max(0, int(context["live_recipes"]) - int(snap["plan_recipes"] or 0)) if snap["plan_recipes"] is not None else 0
    if need <= current:
        outcome = "unchanged"          # nothing owed (or never lowered automatically, #65 Q4), whatever the status
    elif snap["status"] not in LIVE:
        # The database only queues overage for a paying subscription; one that stopped paying since then is never
        # charged, and the unbilled recipe fails visibly (app.jobs, Sentry) for a person to look at (#65 Q8).
        raise PermanentJobError(f"subscription {sub_id} is {snap['status']}: recipe overage not charged")
    else:
        amount, unit, cap = snap["amount_per_period"], snap["recipe_unit_amount"], snap["overage_cap"]
        if snap["term"] != "monthly" or None in (amount, unit, cap):
            raise PermanentJobError(f"subscription {sub_id} takes no overage (term or amounts unknown): nothing charged")
        projected = amount + (need - current) * unit
        if projected > cap:
            raise PermanentJobError(f"recipe overage on {sub_id} would reach {projected} over the cap {cap}: "
                                    "nothing charged")
        # Unique per job and starting quantity: a later raise to the same number after a portal change is a new
        # request, while a retry of this job reuses the key.
        key = f"nutrivo-recipe-overage-{job.id}-{current}-{need}"
        if item:
            stripe.set_item_quantity(item["id"], need, idempotency_key=key)
        else:
            price = stripe.price_by_lookup(recipe_lookup_key(snap["plan"], "month"))
            if not price or not price.get("id"):
                raise PermanentJobError(f"no recipe add-on price for {snap['plan']}: nothing charged")
            stripe.add_item(sub_id, price["id"], need, idempotency_key=key)
        sub = stripe.subscription(sub_id)
        snap = snapshot(sub, stripe.product, stripe.price_by_lookup)
        outcome = "raised"
    applied = store.apply_subscription(ws, snap, "overage", job.id)
    ctx.heartbeat(outcome=outcome, recipes=need, applied=applied)
    log.info("recipe_overage finished", extra=kv(stripe_subscription_id=sub_id, outcome=outcome, quantity=need))
    return outcome


def dunning(job: Job, ctx: JobContext, store: BillingStore, stripe: Stripe) -> dict[str, int]:
    counts = {"notified": 0, "resolved": 0, "duplicate": 0, "failed": 0}
    with obs.cron_checkin(obs.DUNNING_MONITOR, obs.DUNNING_CONFIG):
        for step in store.dunning_due():
            invoice_id, day, ws = step["stripe_invoice_id"], int(step["day"]), step["workspace_id"]
            try:
                invoice = stripe.invoice(invoice_id)
                outcome = "resolved" if invoice.get("status") in SETTLED else "notified"
                if outcome == "notified" and day in (3, 7):
                    try:
                        attempt = stripe.pay_invoice(invoice_id,
                                                     idempotency_key=f"nutrivo-dunning-{invoice_id}-{day}")
                    except Exception as exc:   # a failed retry never holds back the day's notice
                        sentry_sdk.capture_exception(exc)
                        log.error("dunning retry failed", exc_info=exc,
                                  extra=kv(stripe_invoice_id=invoice_id, day=day))
                        attempt = {"declined": True, "code": "retry_error"}
                    if not attempt.get("declined") and attempt.get("status") == "paid":
                        outcome = "resolved"
                recorded = store.record_dunning_step(ws, invoice_id, day, outcome, job.id)
                counts[outcome if recorded == "recorded" else "duplicate"] += 1
            except Exception as exc:     # one invoice never stops the others; the run still ends in error
                counts["failed"] += 1
                sentry_sdk.capture_exception(exc)
                log.error("dunning step failed", exc_info=exc,
                          extra=kv(stripe_invoice_id=invoice_id, day=day))
            ctx.heartbeat(**counts)
        ctx.heartbeat(**counts)
        log.info("dunning finished", extra=kv(**counts))
        if counts["failed"]:
            raise DunningIncomplete(f"{counts['failed']} dunning steps could not be taken")
    return counts


@handler("recipe_overage")
def recipe_overage_job(job: Job, ctx: JobContext) -> None:
    recipe_overage(job, ctx, ctx.store, stripe_client(ctx))  # type: ignore[arg-type]


@handler("dunning")
def dunning_job(job: Job, ctx: JobContext) -> None:
    dunning(job, ctx, ctx.store, stripe_client(ctx))  # type: ignore[arg-type]


@handler("billing_sync")
def billing_sync(job: Job, ctx: JobContext) -> None:
    sync(job, ctx, ctx.store, stripe_client(ctx))  # type: ignore[arg-type]  # PgStore implements BillingStore


@handler("billing_reconcile")
def billing_reconcile(job: Job, ctx: JobContext) -> None:
    reconcile(job, ctx, ctx.store, stripe_client(ctx))  # type: ignore[arg-type]
