"""A Stripe subscription as the snapshot app.apply_subscription stores (T-702, docs/08).

Which item is the plan and which are add-ons comes from the price metadata the T-701 catalogue writes
(nutrivo_kind, nutrivo_plan, nutrivo_addon); the plan's dials come from its product's metadata (editors, recipes:
a number, or "unlimited"). Add-on quantities raise them: editor seats by `editor_seat`, recipes by `recipe`.
A subscription without exactly one Nutrivo plan item is not Nutrivo's and is never applied.

BE-34 (T-704): the snapshot also carries what the overage cap is checked against, all from Stripe (D-18): the plan's
own recipes, the net recurring amount of every item (unit_amount × quantity, per term), the unit amount of this plan's
recipe add-on (the item's own price, else the catalogue price by lookup key) and the plan product's `overage_cap`
metadata. An annual term carries no cap (#65 Q2), and an amount Stripe does not state is None, never a guess: the
database then allows no overage."""
from __future__ import annotations

import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from ..errors import SafeError

PLANS = ("basic", "standard", "advanced")
TERMS = {"month": "monthly", "year": "annual"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


class NotNutrivo(SafeError):
    """The subscription has no Nutrivo plan price, or more than one."""


def _id(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("id")
    return value if isinstance(value, str) and value else None


def _dial(value: Any) -> int | None:
    return int(value) if isinstance(value, str) and value.isdigit() else None


def workspace_id(sub: dict[str, Any]) -> str | None:
    value = (sub.get("metadata") or {}).get("workspace_id")
    return value.lower() if isinstance(value, str) and UUID.match(value) else None


def subscription_id_of(obj: dict[str, Any]) -> str | None:
    """The subscription a webhook object is about: the subscription itself, a checkout session's or an invoice's (the
    invoice field moved to parent.subscription_details in API 2025-03-31.basil; both are read)."""
    if obj.get("object") == "subscription":
        return _id(obj.get("id"))
    return _id(obj.get("subscription")) or _id(((obj.get("parent") or {}).get("subscription_details") or {})
                                               .get("subscription"))


def _amount(price: dict[str, Any]) -> int | None:
    value = price.get("unit_amount")
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def recipe_lookup_key(plan: str, interval: str) -> str:
    """The T-701 catalogue's lookup key for this plan's recipe add-on (docs/08 §The catalogue script)."""
    return f"nutrivo_addon_recipe_{plan}_eur_{interval}"


def recipe_item(sub: dict[str, Any]) -> dict[str, Any] | None:
    items = (sub.get("items") or {}).get("data") or []
    found = [i for i in items if ((i.get("price") or {}).get("metadata") or {}).get("nutrivo_addon") == "recipe"]
    return found[0] if len(found) == 1 else None


def snapshot(sub: dict[str, Any], product: Callable[[str], dict[str, Any]],
             price_by_lookup: Callable[[str], dict[str, Any] | None] | None = None) -> dict[str, Any]:
    items = (sub.get("items") or {}).get("data") or []
    plans = [i for i in items if ((i.get("price") or {}).get("metadata") or {}).get("nutrivo_kind") == "plan"]
    if len(plans) != 1:
        raise NotNutrivo(f"subscription {_id(sub.get('id'))} has {len(plans)} Nutrivo plan items")
    price = plans[0]["price"]
    plan = price["metadata"].get("nutrivo_plan")
    if plan not in PLANS:
        raise NotNutrivo(f"subscription {_id(sub.get('id'))} has an unknown plan")
    prod = price.get("product")
    dials = ((prod if isinstance(prod, dict) else product(prod) if isinstance(prod, str) else {}).get("metadata")
             or {})

    def addon(key: str) -> int:
        return sum(int(i.get("quantity") or 0) for i in items
                   if ((i.get("price") or {}).get("metadata") or {}).get("nutrivo_addon") == key)

    editors, recipes = _dial(dials.get("editors")), _dial(dials.get("recipes"))
    interval = ((price.get("recurring") or {}).get("interval")) or ""
    amounts = [_amount(i.get("price") or {}) for i in items]
    amount = (None if any(a is None for a in amounts)
              else sum(a * int(i.get("quantity") or 0) for a, i in zip(amounts, items, strict=True)))  # type: ignore[operator]
    item = recipe_item(sub)
    recipe_price = (item or {}).get("price") or (
        price_by_lookup(recipe_lookup_key(plan, interval)) if price_by_lookup and recipes is not None else None) or {}
    cap = _dial(dials.get("overage_cap")) if interval == "month" else None
    period_end = sub.get("current_period_end") or max((int(i.get("current_period_end") or 0) for i in items), default=0)
    return {
        "customer_id": _id(sub.get("customer")),
        "subscription_id": _id(sub.get("id")),
        "plan": plan,
        "term": TERMS.get(((price.get("recurring") or {}).get("interval")) or ""),
        "status": sub.get("status"),
        "editor_seats": None if editors is None else editors + addon("editor_seat"),
        "recipes_included": None if recipes is None else recipes + addon("recipe"),
        "current_period_end": datetime.fromtimestamp(int(period_end), UTC).isoformat() if period_end else None,
        "plan_recipes": recipes,
        "amount_per_period": amount,
        "recipe_unit_amount": _amount(recipe_price) if recipes is not None else None,
        "overage_cap": cap if recipes is not None else None,
    }
