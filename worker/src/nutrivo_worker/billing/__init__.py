"""Billing (D-18, docs/08): Stripe is the source of truth; Postgres mirrors what the product decides on (T-702).

stripe.py reads subscriptions and products from Stripe (read only, test mode outside prod); mirror.py maps a Stripe
subscription onto the snapshot app.apply_subscription stores. The handlers are in handlers/billing.py."""
