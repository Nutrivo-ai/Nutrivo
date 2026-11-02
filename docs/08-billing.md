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

Recipes included and seats per plan: take the figures from `design/build/Nutrivo Pricing - Priced Ladder.dc.html`
(authoritative for figures; its Free row is stale). Dials: recipes (families, not pack codes), regions sold whole,
editor seats only (viewers free, external editors count). Never metered: checks and re-checks, language-correct
checking, the four states, provenance, coverage links, named registration obligations, reading your own answer,
viewer seats, supplier upload links, data export.

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
`invoice.payment_failed`. Each is written to `app.payment_events` once (primary key = Stripe event id), then applied
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
   - For the six types above it queues a `billing_sync` job whose payload is `{"stripe_event_id"}` only.
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
- Day 14 (`new_artwork_stopped`) is set by the dunning schedule (T-704), not here.
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

## Dunning (BE-36)
Days 0, 3 and 7: notify and retry, no restriction. Day 14: `status = new_artwork_stopped`, which stops new artworks
only. Nothing is ever deleted, and verification of shared documents never breaks.
