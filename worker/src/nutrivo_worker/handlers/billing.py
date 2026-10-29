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

Neither touches reports, supersessions or public.verify_reference: verification outlives the subscription (BE-36)."""
from __future__ import annotations

import re
from typing import Any, Protocol

import sentry_sdk

from .. import observability as obs
from ..billing.mirror import NotNutrivo, snapshot, subscription_id_of
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


class Stripe(Protocol):
    def subscription(self, subscription_id: str) -> dict[str, Any]: ...
    def subscriptions(self) -> Any: ...
    def product(self, product_id: str) -> dict[str, Any]: ...


class ReconcileIncomplete(SafeError):
    """Some subscriptions could not be applied; the others were."""


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
            snap = snapshot(sub, stripe.product)
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
                snap = snapshot(sub, stripe.product)
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


@handler("billing_sync")
def billing_sync(job: Job, ctx: JobContext) -> None:
    sync(job, ctx, ctx.store, stripe_client(ctx))  # type: ignore[arg-type]  # PgStore implements BillingStore


@handler("billing_reconcile")
def billing_reconcile(job: Job, ctx: JobContext) -> None:
    reconcile(job, ctx, ctx.store, stripe_client(ctx))  # type: ignore[arg-type]
