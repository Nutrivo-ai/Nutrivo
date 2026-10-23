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

## Dunning (BE-36)
Days 0, 3 and 7: notify and retry, no restriction. Day 14: `status = new_artwork_stopped`, which stops new artworks
only. Nothing is ever deleted, and verification of shared documents never breaks.
