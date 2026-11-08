"""A small Stripe REST client for the worker (T-702, T-704). No SDK, the standard library transport.

Reads: subscriptions, products, prices by lookup key, invoices. Writes (T-704), each with an Idempotency-Key so a
retried job never acts twice: a recipe add-on quantity (BE-34) and an invoice payment attempt (BE-36).

The key is never logged or put in an error. Outside prod a live key is refused (config.py) and so is any response
with `livemode: true`, so a misconfigured key can never mirror live data into a test environment (gate G8, T-705).
429, 5xx and transport errors are retried a bounded number of times; anything else fails at once."""
from __future__ import annotations

import json
import time
import urllib.parse
from collections.abc import Callable, Iterator
from typing import Any

from ..errors import SafeError
from ..sources.http import Transport, TransportError, UrllibTransport

API = "https://api.stripe.com"
MAX_ATTEMPTS = 3
PAGE_SIZE = 100


class StripeError(SafeError):
    """Stripe could not answer, or answered something the worker refuses. The message holds ids and codes only."""


class StripeClient:
    def __init__(self, key: str, *, env: str, transport: Transport | None = None,
                 sleep: Callable[[float], None] = time.sleep, max_attempts: int = MAX_ATTEMPTS):
        self._key = key
        self.env = env
        self.transport = transport or UrllibTransport(timeout_s=30)
        self.sleep = sleep
        self.max_attempts = max_attempts
        self._products: dict[str, dict[str, Any]] = {}

    def _get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict[str, Any]:
        return self._call("GET", path, params)

    def _call(self, method: str, path: str, params: list[tuple[str, str]] | None = None,
              idempotency_key: str | None = None, declined_ok: bool = False) -> dict[str, Any]:
        query = urllib.parse.urlencode(params) if params else ""
        url = f"{API}{path}" + (f"?{query}" if query and method == "GET" else "")
        headers = {"Authorization": f"Bearer {self._key}", "Accept": "application/json"}
        if method != "GET":
            if self._key.startswith(("sk_live_", "rk_live_")) and self.env != "prod":
                raise StripeError(f"a live key may not write in {self.env}: refused (gate G8)")
            if not idempotency_key:
                raise StripeError(f"{method} {path} needs an idempotency key")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Idempotency-Key"] = idempotency_key
        last = ""
        for attempt in range(1, self.max_attempts + 1):
            try:
                resp = (self.transport.send(method, url, headers) if method == "GET"
                        else self.transport.send(method, url, headers, query.encode()))
            except TransportError as exc:
                last = f"transport {exc}"
            else:
                if resp.status == 200 or (declined_ok and resp.status == 402):
                    body = json.loads(resp.body)
                    obj = body.get("error", {}).get("invoice") if resp.status == 402 else body
                    if (body.get("livemode") is True or (obj or {}).get("livemode") is True) and self.env != "prod":
                        raise StripeError(f"Stripe answered in live mode in {self.env}: refused (gate G8)")
                    return body if resp.status == 200 else {"declined": True,
                                                             "code": str(body.get("error", {}).get("code", ""))[:60]}
                last = f"HTTP {resp.status}"
                if resp.status != 429 and resp.status < 500:
                    raise StripeError(f"{method} {path} failed: {last}")
            if attempt < self.max_attempts:
                self.sleep(2 ** (attempt - 1))
        raise StripeError(f"{method} {path} failed after {self.max_attempts} attempts: {last}")

    def subscription(self, subscription_id: str) -> dict[str, Any]:
        return self._get(f"/v1/subscriptions/{urllib.parse.quote(subscription_id, safe='')}")

    def subscriptions(self) -> Iterator[dict[str, Any]]:
        """Every subscription in every status, a page at a time."""
        after: str | None = None
        while True:
            params = [("status", "all"), ("limit", str(PAGE_SIZE))] + ([("starting_after", after)] if after else [])
            page = self._get("/v1/subscriptions", params)
            data = page.get("data") or []
            yield from data
            if not page.get("has_more") or not data:
                return
            after = data[-1]["id"]

    def price_by_lookup(self, lookup_key: str) -> dict[str, Any] | None:
        """The active catalogue price for a lookup key (code reads prices by lookup key, never by id: docs/08)."""
        data = self._get("/v1/prices", [("lookup_keys[]", lookup_key), ("active", "true"), ("limit", "1")]).get("data")
        return data[0] if data else None

    def invoice(self, invoice_id: str) -> dict[str, Any]:
        return self._get(f"/v1/invoices/{urllib.parse.quote(invoice_id, safe='')}")

    def pay_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict[str, Any]:
        """One payment attempt with the default payment method. A decline (402) is an answer, not an error:
        {"declined": True, "code": ...}."""
        return self._call("POST", f"/v1/invoices/{urllib.parse.quote(invoice_id, safe='')}/pay", [],
                          idempotency_key=idempotency_key, declined_ok=True)

    def set_item_quantity(self, item_id: str, quantity: int, *, idempotency_key: str) -> dict[str, Any]:
        """Stripe's default proration (create_prorations): the change shows on the next invoice (#65 Q3)."""
        return self._call("POST", f"/v1/subscription_items/{urllib.parse.quote(item_id, safe='')}",
                          [("quantity", str(quantity)), ("proration_behavior", "create_prorations")],
                          idempotency_key=idempotency_key)

    def add_item(self, subscription_id: str, price_id: str, quantity: int, *, idempotency_key: str) -> dict[str, Any]:
        return self._call("POST", "/v1/subscription_items",
                          [("subscription", subscription_id), ("price", price_id), ("quantity", str(quantity)),
                           ("proration_behavior", "create_prorations")], idempotency_key=idempotency_key)

    def product(self, product_id: str) -> dict[str, Any]:
        """Products carry the plan's dials (metadata from the T-701 catalogue); a run reads each one once."""
        if product_id not in self._products:
            self._products[product_id] = self._get(f"/v1/products/{urllib.parse.quote(product_id, safe='')}")
        return self._products[product_id]
