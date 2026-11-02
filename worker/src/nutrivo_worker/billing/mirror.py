"""A Stripe subscription as the snapshot app.apply_subscription stores (T-702, docs/08).

Which item is the plan and which are add-ons comes from the price metadata the T-701 catalogue writes
(nutrivo_kind, nutrivo_plan, nutrivo_addon); the plan's dials come from its product's metadata (editors, recipes:
a number, or "unlimited"). Add-on quantities raise them: editor seats by `editor_seat`, recipes by `recipe`.
A subscription without exactly one Nutrivo plan item is not Nutrivo's and is never applied."""
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


def snapshot(sub: dict[str, Any], product: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
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
    }
