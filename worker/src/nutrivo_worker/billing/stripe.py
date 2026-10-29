"""A small, read-only Stripe REST client for the worker (T-702). No SDK: two GETs, the standard library transport.

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
        url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        headers = {"Authorization": f"Bearer {self._key}", "Accept": "application/json"}
        last = ""
        for attempt in range(1, self.max_attempts + 1):
            try:
                resp = self.transport.send("GET", url, headers)
            except TransportError as exc:
                last = f"transport {exc}"
            else:
                if resp.status == 200:
                    body = json.loads(resp.body)
                    if body.get("livemode") is True and self.env != "prod":
                        raise StripeError(f"Stripe answered in live mode in {self.env}: refused (gate G8)")
                    return body
                last = f"HTTP {resp.status}"
                if resp.status != 429 and resp.status < 500:
                    raise StripeError(f"GET {path} failed: {last}")
            if attempt < self.max_attempts:
                self.sleep(2 ** (attempt - 1))
        raise StripeError(f"GET {path} failed after {self.max_attempts} attempts: {last}")

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

    def product(self, product_id: str) -> dict[str, Any]:
        """Products carry the plan's dials (metadata from the T-701 catalogue); a run reads each one once."""
        if product_id not in self._products:
            self._products[product_id] = self._get(f"/v1/products/{urllib.parse.quote(product_id, safe='')}")
        return self._products[product_id]
