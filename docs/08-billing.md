# 08 · Billing

Stripe Billing and Stripe Tax are the source of truth (D-18). Postgres mirrors what the product needs to decide.

## Plans and dials (D-03)
| Plan | Price (net, per month) | Regions | Notes |
|---|---|---|---|
| Free | €0 | EU | Three new label artworks per workspace, the whole product, no card, no clock (BE-32) |
| Basic | €249 | One, cannot add another | Overage stops at €374, then the next plan is offered (BE-34) |
| Standard | €499 | One plus one more at €199 (€698) | Overage stops at €749 |
| Advanced | from €999 | All three | No seat check |
| Partner (after launch) | €1,499 per 10 client workspaces | — | N01 |

Dials: recipes (families, not pack codes), regions sold whole,
editor seats only (viewers free, external editors count). Never metered: checks and re-checks, language-correct
checking, the four states, provenance, coverage links, named registration obligations, reading your own answer,
viewer seats, supplier upload links, data export.

## Recipes, seats, add-ons and regions (D-03)
Copied from the Priced Ladder on 3 Nov 2026. `config/pricing.ts` holds the same figures.

| Plan | Recipes | Editor seats | Yearly | Add-ons (month / year) |
|---|---|---|---|---|
| Free | no limit within the three-artwork allowance | no seat check (D-21) | — | — |
| Basic | 10 | 3 | €2,490 | recipe €15 / €150 · editor €50 / €500 |
| Standard | 30 | 5 | €4,990 | region €199 / €1,990 · recipe €12 / €120 · editor €50 / €500 |
| Advanced | no limit | no seat check | from €9,990 | — |

**Regions at launch (D-03, 3 Nov 2026).** Only the EU region exists. Every plan shows the EU; Standard and Advanced
say that more regions are added as they launch (UK first, planned Q1 2027). The region add-on cannot be bought until a
second region is released. Prices do not change.

## Stripe mapping
One product per plan; one price per currency and term (EUR at launch; GBP and USD later as separate catalogue rows,
never converted at runtime, BE-31); the extra region as a quantity item; recipe overage as a quantity item capped by
the RPC. A single `config/pricing.ts` feeds both the pricing page and the idempotent catalogue script.
Checkout uses automatic tax and tax-ID collection; the customer portal handles cards, cancellation and invoices.

### The catalogue script (T-701)
`make stripe-catalogue` (ENV=dev; `DRY=1` previews) runs `scripts/stripe/catalogue.ts`, which makes the Stripe
catalogue match `config/pricing.ts`. It runs in test mode only: it refuses any key but `sk_test_`/`rk_test_`, aborts
if Stripe answers `livemode: true`, and never prints the key. Live mode is gate G8 (T-705).

| Stripe object | Identity | From config/pricing.ts |
|---|---|---|
| Product per paid plan | id `nutrivo_plan_<plan>` | Basic, Standard, Advanced; metadata: recipes, editors, regions included and max, overage cap (cents), `price_from` |
| Product per add-on | id `nutrivo_addon_<addon>` | `region` (Standard), `recipe` (Basic, Standard), `editor_seat` (Basic, Standard) |
| Plan price | lookup key `nutrivo_plan_<plan>_<currency>_<interval>` | Monthly and yearly, net, `tax_behavior: exclusive` |
| Add-on price | lookup key `nutrivo_addon_<addon>_<plan>_<currency>_<interval>` | One price per plan that may buy it, as a quantity item |

The free allowance has no product (D-21: no subscription row) and Partner is not sold before launch. Advanced
carries its floor (€999 per month, €9,990 per year); work above the floor is quoted, not catalogued.

A re-run changes nothing. Prices are immutable in Stripe, so a changed amount creates a new price that takes the
lookup key over (`transfer_lookup_key`) and archives the old one. An archived or renamed catalogue object is restored.
An active price on a `nutrivo_` product that the config no longer names is archived. Nothing is deleted. Code reads
prices by lookup key, never by price id.

## VAT (BE-35)
Swedish VAT in full for Swedish customers; EU reverse charge on a validated VAT number; one-stop shop for EU
customers without one; zero outside the EU. All prices are stored and shown net; VAT is added on the invoice.

## Webhooks
`checkout.session.completed`, `customer.subscription.created / updated / deleted`, `invoice.paid`,
`invoice.payment_failed`, and (T-704) `invoice.voided` and `invoice.marked_uncollectible`, which settle an invoice for
dunning. The Stripe webhook endpoint must send all eight. Each is written to `app.payment_events` once (primary key = Stripe event id), then applied
to `app.subscriptions` and `app.workspaces.plan / status`.

### How it runs (T-702)
1. **The function.** `supabase/functions/stripe-webhook` (`verify_jwt = false`: Stripe sends no Supabase JWT)
   verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`: HMAC-SHA256 over `t.payload`, a 300-second
   tolerance, and any one matching `v1` accepted (secret rotation).
   - An unsigned, wrongly signed, stale or malformed request gets 400 and nothing is stored.
   - Otherwise the function calls `app.record_stripe_event` with the service role and answers 200, whether the event
     was stored now or before.
   - A database failure answers 500, so Stripe retries.
   - Logs hold event ids, types and outcomes only.
2. **Storing.** `app.record_stripe_event` is service role only.
   - It inserts the event with `on conflict do nothing` and resolves the workspace (see the checkout contract below).
   - For the eight types above it queues a `billing_sync` job whose payload is `{"stripe_event_id"}` only.
   - Any other type is stored and queues nothing.
3. **Applying.** The worker's `billing_sync` re-reads the subscription from Stripe rather than trusting the event
   body, so duplicates and out-of-order deliveries converge on Stripe's current state. It applies the subscription
   through `app.apply_subscription`.
   - **Which item is the plan.** The plan item and the add-ons come from the catalogue's price metadata (`nutrivo_kind`,
     `nutrivo_plan`, `nutrivo_addon`).
   - **Seats and recipes.** These come from the plan product's `editors` and `recipes`, plus the `editor_seat` and
     `recipe` add-on quantities. `unlimited` means no check.
   - **Not Nutrivo's.** A subscription without exactly one Nutrivo plan price is never applied.
4. **Reconciliation.** pg_cron queues one `billing_reconcile` job a day (03:17 UTC, idempotent by date).
   - It applies every subscription in Stripe the same way, inside the Sentry cron check-in `stripe-reconcile`.
   - Any correction it makes is reported to Sentry as a warning (docs/18). A subscription it cannot apply fails the run
     after the others are applied.
   - Outside prod the worker refuses a live key and any live-mode answer (gate G8).

| Stripe subscription status | Workspace plan | Workspace status | Mirror |
|---|---|---|---|
| `active`, `trialing` | the subscribed plan | `active` (also from `dunning` or `new_artwork_stopped`) | plan, term, seats, recipes, period end |
| `past_due`, `unpaid` | the subscribed plan | `active` becomes `dunning`, which restricts nothing; `new_artwork_stopped` stays | as above |
| `canceled`, `incomplete_expired` | `free` | unchanged | Stripe's status kept, seats and recipes cleared (no seat check, D-21) |
| `incomplete`, `paused` | unchanged | unchanged | Stripe's status |

The table has a few exceptions:
- A `closed` or `dormant` workspace keeps its status.
- The end of an older subscription never downgrades a workspace whose mirrored subscription is a different, live one
  (`stale`).
- A second live subscription for a workspace is refused (23505): the job fails visibly and a person looks.
- Day 14 (`new_artwork_stopped`) is set by the dunning schedule (§Dunning, T-704), not here.
- Nothing is deleted, and none of this touches `public.verify_reference` (CLAUDE.md non-negotiable 9).

**Checkout contract (T-703).**
- A Checkout Session sets `client_reference_id` and `subscription_data.metadata.workspace_id` to the workspace id.
- That id must come from the caller's own admin membership (`auth.uid()`), checked in the database, never from the
  request. Otherwise a caller could attach a subscription to a workspace they do not administer.
- Attribution order (`private.stripe_workspace`):
  1. A subscription already in the mirror keeps its workspace, whatever its metadata says.
  2. Otherwise the metadata or `client_reference_id`.
  3. Otherwise the mirrored customer.
- An event whose workspace cannot be found stays stored, and its job fails visibly.

## Overage (BE-34, T-704)
Overage is capped at 1.5x list (D-03): €374 on Basic, €749 on Standard. Past the cap the next plan is offered instead
of a larger invoice.
- **What the database checks.** `private.require_recipe_room` runs under a per-workspace lock whenever a new recipe
  (family) is created or a discontinued one is made active again.
  - A recipe already paid for (`recipes_included`, the plan's own plus recipe add-ons) is always allowed.
  - One more is allowed only for a paying subscription (`active`, `trialing`; never in dunning) on a monthly term,
    while `amount_per_period + extra × recipe_unit_amount ≤ overage_cap`.
    It then queues a `recipe_overage` job.
  - Otherwise it is refused with P0034. The hint names the plan, the cap, the term and `next_plan` (Basic → Standard,
    Standard → Advanced). The screen offers that plan.
- **Where the amounts come from (D-18).** Every amount comes from Stripe, never from a copy of the price list. The
  worker's snapshot (billing_sync, billing_reconcile and recipe_overage alike) mirrors four fields onto
  `app.subscriptions`:
  - `plan_recipes`;
  - `amount_per_period`: the net unit amount times the quantity, summed over every recurring item;
  - `recipe_unit_amount`: this plan's recipe add-on, from the item's own price or the catalogue lookup key;
  - `overage_cap`: the plan product's `overage_cap` metadata, written by the T-701 catalogue from `config/pricing.ts`.

  An amount Stripe does not state is stored as null, and then no overage is allowed.
- **Charging.** The `recipe_overage` job re-reads the subscription from Stripe and checks the cap again against
  Stripe's own amounts.
  - It raises the recipe add-on quantity to `live recipes − plan recipes`, using Stripe's default proration, so the
    change shows on the next invoice.
  - The write carries an Idempotency-Key per job and starting quantity, so a retry of the job is never charged twice
    and a later raise to the same number after a portal change is a new request.
  - It then applies the mirror (`apply_subscription`, source `overage`).
  - Over the cap, on an annual term, or when an amount is unknown, it fails permanently and nothing is charged.
  - It never lowers the quantity. A subscription that stopped paying after the recipe was allowed is never charged:
    the job fails visibly (`app.jobs`, Sentry) for a person to look at (#65 Q8).
- **Conservative defaults (questions on #65).**
  1. Every recurring item counts toward the cap, so Standard with the region add-on (€698) has room for 4 recipes.
  2. An annual term has no overage.
  3. Proration is Stripe's default.
  4. The add-on is not lowered automatically when a recipe is discontinued.

## Dunning (BE-36, T-704)
Days 0, 3 and 7: notify and retry, no restriction. Day 14: `status = new_artwork_stopped`, which stops new artworks
only. Nothing is ever deleted, and verification of shared documents never breaks.

How it runs:
1. **Day 0** is the first `invoice.payment_failed` event stored for a Stripe invoice (the event's `created`). A later
   `invoice.paid`, `invoice.voided` or `invoice.marked_uncollectible` event for the same invoice, or a step recorded
   `resolved`, settles it and ends its schedule.
2. **The daily job.** pg_cron queues one `dunning` job a day at 07:41 UTC (`dunning:<UTC date>`, payload `{}`).
   - The worker runs it inside the Sentry cron check-in `dunning` (docs/17).
   - `app.dunning_due()` returns, per open invoice, only the latest day that has passed and has not been taken. A late
     run therefore sends one email, never a backlog; a day 3 or 7 it skipped is also a skipped retry (built behaviour).
   - Closed and dormant workspaces are skipped, and so is any workspace whose mirrored subscription is not `past_due`
     or `unpaid`: after a cancellation nothing is retried, emailed or stopped (#65 Q9).
3. **Each step.** The worker re-reads the invoice from Stripe.
   - If it is `paid`, `void` or `uncollectible`, the step is recorded `resolved` and nothing is sent.
   - On days 3 and 7 it retries the payment (`POST /v1/invoices/{id}/pay`, Idempotency-Key per invoice and day). A
     decline is the expected answer; a payment that succeeds is recorded `resolved`. A retry that errors otherwise
     goes to Sentry and the day's notice still goes out.
   - Otherwise `app.record_dunning_step` records the step `notified`, once per invoice and day, in
     `app.dunning_steps` (insert-only; workspace admins read it).
   - A `notified` step queues the `payment_failed` email (`notify`, key `payment_failed:<invoice>:<day>`) to the
     invoice's `customer_email`, which T-703 makes the finance address.
   - On day 14 a `notified` step moves the workspace from `dunning` to `new_artwork_stopped` while the subscription is
     `past_due` or `unpaid`, audited `billing.new_artwork_stopped`. The email's payload says whether the workspace is
     stopped, and the day-14 copy claims a stop only when there is one.
4. **Failures.** One invoice that fails never stops the others. The run then fails and retries, bounded by
   `max_attempts`; every step already recorded stays recorded.
5. **Recovery.** A paid invoice or an active subscription returns the workspace to `active` (`apply_subscription`,
   T-702). A cancelled subscription leaves `dunning` or `new_artwork_stopped` for `active` (on the free plan) once
   no invoice of the workspace is still open.

Day 7's admin-only banner is a web change that is not built yet; admins can already read `app.dunning_steps`.

**Open on #65:**
- Who retries. Nutrivo retries on days 3 and 7, so Stripe's own automatic retries should be off in the Stripe
  dashboard, or a card is tried twice.
- The email copy, which follows the Billing Settings design, and its recipients.
- The day-7 banner.
- Q9: whether an open invoice is still collected (retried, emailed, day 14) after the subscription is cancelled.
  The built default is no.
