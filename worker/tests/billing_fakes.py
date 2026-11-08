"""Stripe objects shaped like the T-701 catalogue's, and an in-memory Stripe, for the T-702 and T-704 billing tests.
Amounts are config/pricing.ts's (net cents) and are only put on prices when a test asks (`amounts=True`)."""
from __future__ import annotations

import re
from typing import Any

PERIOD_END = 1_800_000_000
PRODUCTS = {
    "nutrivo_plan_basic": {"id": "nutrivo_plan_basic", "metadata": {"nutrivo_plan": "basic", "editors": "3", "recipes": "10", "overage_cap": "37400"}},
    "nutrivo_plan_standard": {"id": "nutrivo_plan_standard",
                              "metadata": {"nutrivo_plan": "standard", "editors": "5", "recipes": "30",
                                           "overage_cap": "74900"}},
    "nutrivo_plan_advanced": {"id": "nutrivo_plan_advanced",
                              "metadata": {"nutrivo_plan": "advanced", "editors": "unlimited", "recipes": "unlimited",
                                           "overage_cap": ""}},
}
# config/pricing.ts, net cents: (month, year)
PLAN_AMOUNTS = {"basic": (24900, 249000), "standard": (49900, 499000), "advanced": (99900, 999000)}
ADDON_AMOUNTS = {("recipe", "basic"): (1500, 15000), ("recipe", "standard"): (1200, 12000),
                 ("editor_seat", "basic"): (5000, 50000), ("editor_seat", "standard"): (5000, 50000),
                 ("region", "standard"): (19900, 199000)}


def addon_price(key: str, plan: str, interval: str = "month", *, amounts: bool = True) -> dict[str, Any]:
    price: dict[str, Any] = {"id": f"price_{key}_{plan}_{interval}", "product": f"nutrivo_addon_{key}",
                             "recurring": {"interval": interval},
                             "lookup_key": f"nutrivo_addon_{key}_{plan}_eur_{interval}",
                             "metadata": {"nutrivo_kind": "addon", "nutrivo_addon": key, "nutrivo_plan": plan}}
    if amounts:
        price["unit_amount"] = ADDON_AMOUNTS[(key, plan)][interval == "year"]
    return price


def subscription(sid: str = "sub_A1", *, status: str = "active", ws: str | None = None, plan: str = "basic",
                 interval: str = "month", customer: str = "cus_A", addons: dict[str, int] | None = None,
                 amounts: bool = False) -> dict[str, Any]:
    items: list[dict[str, Any]] = [{
        "id": "si_plan", "quantity": 1, "current_period_end": PERIOD_END,
        "price": {"id": f"price_{plan}", "product": f"nutrivo_plan_{plan}", "recurring": {"interval": interval},
                  "lookup_key": f"nutrivo_plan_{plan}_eur_{interval}",
                  "metadata": {"nutrivo_kind": "plan", "nutrivo_plan": plan, "nutrivo_interval": interval}}}]
    if amounts:
        items[0]["price"]["unit_amount"] = PLAN_AMOUNTS[plan][interval == "year"]
    for key, qty in (addons or {}).items():
        price = addon_price(key, plan, interval, amounts=amounts) if amounts else {
            "id": f"price_{key}", "product": f"nutrivo_addon_{key}", "recurring": {"interval": interval},
            "metadata": {"nutrivo_kind": "addon", "nutrivo_addon": key, "nutrivo_plan": plan}}
        items.append({"id": f"si_{key}", "quantity": qty, "current_period_end": PERIOD_END, "price": price})
    return {"id": sid, "object": "subscription", "customer": customer, "status": status,
            "metadata": {"workspace_id": ws} if ws else {}, "items": {"object": "list", "data": items}}


class FakeStripe:
    def __init__(self, *subs: dict[str, Any]):
        self.subs = {s["id"]: s for s in subs}
        self.product_reads: list[str] = []
        self.invoices: dict[str, dict[str, Any]] = {}
        self.writes: list[tuple[str, str, Any, str]] = []      # (call, object id, value, idempotency key)
        self.pay_succeeds: set[str] = set()

    def put(self, sub: dict[str, Any]) -> None:
        self.subs[sub["id"]] = sub

    def subscription(self, subscription_id: str) -> dict[str, Any]:
        return self.subs[subscription_id]

    def subscriptions(self):
        yield from list(self.subs.values())

    def product(self, product_id: str) -> dict[str, Any]:
        self.product_reads.append(product_id)
        return PRODUCTS[product_id]

    # ── T-704 ────────────────────────────────────────────────────────────────────────────────────────────────
    def price_by_lookup(self, lookup_key: str) -> dict[str, Any] | None:
        m = re.fullmatch(r"nutrivo_addon_([a-z_]+)_(basic|standard|advanced)_eur_(month|year)", lookup_key)
        if not m or (m[1], m[2]) not in ADDON_AMOUNTS:
            return None
        return addon_price(m[1], m[2], m[3])

    def _sub_of_item(self, item_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        for sub in self.subs.values():
            for item in sub["items"]["data"]:
                if item["id"] == item_id:
                    return sub, item
        raise KeyError(item_id)

    def set_item_quantity(self, item_id: str, quantity: int, *, idempotency_key: str) -> dict[str, Any]:
        self.writes.append(("set_item_quantity", item_id, quantity, idempotency_key))
        _, item = self._sub_of_item(item_id)
        item["quantity"] = quantity
        return item

    def add_item(self, subscription_id: str, price_id: str, quantity: int, *, idempotency_key: str) -> dict[str, Any]:
        self.writes.append(("add_item", subscription_id, quantity, idempotency_key))
        sub = self.subs[subscription_id]
        plan = sub["items"]["data"][0]["price"]["metadata"]["nutrivo_plan"]
        interval = sub["items"]["data"][0]["price"]["recurring"]["interval"]
        price = addon_price("recipe", plan, interval)
        assert price["id"] == price_id
        item = {"id": "si_recipe", "quantity": quantity, "current_period_end": PERIOD_END, "price": price}
        sub["items"]["data"].append(item)
        return item

    def invoice(self, invoice_id: str) -> dict[str, Any]:
        return self.invoices[invoice_id]

    def pay_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict[str, Any]:
        self.writes.append(("pay_invoice", invoice_id, None, idempotency_key))
        if invoice_id in self.pay_succeeds:
            self.invoices[invoice_id]["status"] = "paid"
            return self.invoices[invoice_id]
        return {"declined": True, "code": "card_declined"}
