"""Stripe objects shaped like the T-701 catalogue's, and an in-memory Stripe, for the T-702 billing tests."""
from __future__ import annotations

from typing import Any

PERIOD_END = 1_800_000_000
PRODUCTS = {
    "nutrivo_plan_basic": {"id": "nutrivo_plan_basic", "metadata": {"nutrivo_plan": "basic", "editors": "3", "recipes": "10"}},
    "nutrivo_plan_standard": {"id": "nutrivo_plan_standard",
                              "metadata": {"nutrivo_plan": "standard", "editors": "5", "recipes": "30"}},
    "nutrivo_plan_advanced": {"id": "nutrivo_plan_advanced",
                              "metadata": {"nutrivo_plan": "advanced", "editors": "unlimited", "recipes": "unlimited"}},
}


def subscription(sid: str = "sub_A1", *, status: str = "active", ws: str | None = None, plan: str = "basic",
                 interval: str = "month", customer: str = "cus_A", addons: dict[str, int] | None = None) -> dict[str, Any]:
    items: list[dict[str, Any]] = [{
        "id": "si_plan", "quantity": 1, "current_period_end": PERIOD_END,
        "price": {"id": f"price_{plan}", "product": f"nutrivo_plan_{plan}", "recurring": {"interval": interval},
                  "lookup_key": f"nutrivo_plan_{plan}_eur_{interval}",
                  "metadata": {"nutrivo_kind": "plan", "nutrivo_plan": plan, "nutrivo_interval": interval}}}]
    for key, qty in (addons or {}).items():
        items.append({"id": f"si_{key}", "quantity": qty, "current_period_end": PERIOD_END,
                      "price": {"id": f"price_{key}", "product": f"nutrivo_addon_{key}",
                                "recurring": {"interval": interval},
                                "metadata": {"nutrivo_kind": "addon", "nutrivo_addon": key, "nutrivo_plan": plan}}})
    return {"id": sid, "object": "subscription", "customer": customer, "status": status,
            "metadata": {"workspace_id": ws} if ws else {}, "items": {"object": "list", "data": items}}


class FakeStripe:
    def __init__(self, *subs: dict[str, Any]):
        self.subs = {s["id"]: s for s in subs}
        self.product_reads: list[str] = []

    def put(self, sub: dict[str, Any]) -> None:
        self.subs[sub["id"]] = sub

    def subscription(self, subscription_id: str) -> dict[str, Any]:
        return self.subs[subscription_id]

    def subscriptions(self):
        yield from list(self.subs.values())

    def product(self, product_id: str) -> dict[str, Any]:
        self.product_reads.append(product_id)
        return PRODUCTS[product_id]
