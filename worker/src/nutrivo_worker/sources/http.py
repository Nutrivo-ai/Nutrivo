"""HTTP for official sources: one request every `min_interval_s`, bounded retries with backoff for network errors,
429 and 5xx (honouring Retry-After), and redirects followed by hand so every hop is rate limited and recorded.

A bot challenge (the AWS WAF answer EUR-Lex gives automated clients) is never retried or worked around: it fails
at once as `source_blocked`. Record mode keeps each exchange under a directory; replay mode serves them back so tests
never reach the live site."""
from __future__ import annotations

import gzip
import hashlib
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Protocol
from urllib.parse import urljoin, urlsplit

from ..errors import SafeError

USER_AGENT = "Nutrivo-source-fetcher/1 (+https://nutrivo.ai)"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
# Headers worth keeping in a recording; nothing else (cookies, CDN request ids) is stored.
KEPT_HEADERS = ("content-type", "location", "retry-after", "x-amzn-waf-action", "etag", "last-modified")
# Request headers that select a representation, so they are part of a recording's key.
KEY_HEADERS = ("accept", "accept-language")


class SourceError(SafeError):
    """A source document could not be fetched. The message holds ids and a reason code only."""

    reason = "source_error"

    def __init__(self, message: str, reason: str | None = None):
        super().__init__(message)
        if reason:
            self.reason = reason


class SourceBlocked(SourceError):
    reason = "source_blocked"


class TransportError(Exception):
    """The request did not complete (DNS, connection, timeout)."""


class RecordingMissing(SourceError):
    reason = "recording_missing"


@dataclass(frozen=True)
class Response:
    status: int
    headers: Mapping[str, str]          # lower-case names
    body: bytes
    url: str

    def header(self, name: str) -> str | None:
        return self.headers.get(name.lower())


class Transport(Protocol):
    def send(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None = None) -> Response: ...


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None


class UrllibTransport:
    """The standard library, through HTTPS_PROXY when one is set. Redirects are returned, not followed."""

    def __init__(self, timeout_s: float = 120.0):
        self.timeout_s = timeout_s
        self._opener = urllib.request.build_opener(_NoRedirect)

    def send(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None = None) -> Response:
        req = urllib.request.Request(url, data=body, method=method, headers=dict(headers))
        try:
            with self._opener.open(req, timeout=self.timeout_s) as resp:
                return Response(resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read(), url)
        except urllib.error.HTTPError as exc:      # 3xx (not followed), 4xx and 5xx all come back as responses
            return Response(exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read() or b"", url)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            raise TransportError(type(exc).__name__) from exc


def recording_key(method: str, url: str, headers: Mapping[str, str]) -> str:
    sel = {k.lower(): v for k, v in headers.items() if k.lower() in KEY_HEADERS}
    raw = json.dumps([method.upper(), url, sorted(sel.items())])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class RecordingTransport:
    """Passes requests to `inner` and writes each exchange to `directory` as <key>.json and <key>.body.gz."""

    def __init__(self, inner: Transport, directory: Path):
        self.inner, self.directory = inner, Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    def send(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None = None) -> Response:
        resp = self.inner.send(method, url, headers, body)
        key = recording_key(method, url, headers)
        meta = {"method": method.upper(), "url": url,
                "request_headers": {k.lower(): v for k, v in headers.items() if k.lower() in KEY_HEADERS},
                "status": resp.status,
                "headers": {k: v for k, v in resp.headers.items() if k in KEPT_HEADERS},
                "body_sha256": hashlib.sha256(resp.body).hexdigest()}
        (self.directory / f"{key}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
        (self.directory / f"{key}.body.gz").write_bytes(gzip.compress(resp.body, mtime=0))
        return resp


class ReplayTransport:
    """Serves recorded exchanges; a request that was never recorded fails as `recording_missing`."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.requests: list[str] = []

    def send(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None = None) -> Response:
        self.requests.append(url)
        key = recording_key(method, url, headers)
        meta_path = self.directory / f"{key}.json"
        if not meta_path.exists():
            raise RecordingMissing(f"no recording {key} for {method} {url[:200]}")
        meta = json.loads(meta_path.read_text())
        payload = gzip.decompress((self.directory / f"{key}.body.gz").read_bytes())
        if hashlib.sha256(payload).hexdigest() != meta["body_sha256"]:
            raise SourceError(f"recording {key} is corrupt", "recording_corrupt")
        return Response(meta["status"], meta["headers"], payload, url)


def _retry_after_s(value: str | None, now: Callable[[], float]) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        return max(0.0, parsedate_to_datetime(value).timestamp() - now())
    except (TypeError, ValueError):
        return None


@dataclass
class PoliteClient:
    transport: Transport
    min_interval_s: float = 2.0
    max_attempts: int = 4
    backoff_base_s: float = 5.0
    backoff_cap_s: float = 120.0
    max_redirects: int = 5
    https_hosts: tuple[str, ...] = ("publications.europa.eu", "eur-lex.europa.eu")
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    wall: Callable[[], float] = time.time
    _last: float | None = field(default=None, init=False)
    requests_sent: int = field(default=0, init=False)

    def _wait_turn(self) -> None:
        if self._last is not None:
            gap = self.min_interval_s - (self.clock() - self._last)
            if gap > 0:
                self.sleep(gap)
        self._last = self.clock()

    def _upgrade(self, url: str) -> str:
        for host in self.https_hosts:
            if url.startswith(f"http://{host}/"):
                return "https://" + url[len("http://"):]
        return url

    def _send(self, url: str, headers: Mapping[str, str]) -> Response:
        for attempt in range(1, self.max_attempts + 1):
            self._wait_turn()
            self.requests_sent += 1
            delay: float | None
            try:
                resp = self.transport.send("GET", url, headers)
            except TransportError as exc:
                failure, delay = f"network ({exc})", None
            else:
                if resp.header("x-amzn-waf-action"):
                    raise SourceBlocked(f"bot challenge ({resp.header('x-amzn-waf-action')}) from {_host(url)}")
                if resp.status not in RETRY_STATUSES:
                    return resp
                failure, delay = f"HTTP {resp.status}", _retry_after_s(resp.header("retry-after"), self.wall)
            if attempt == self.max_attempts:
                raise SourceError(f"{failure} after {attempt} attempts from {_host(url)}", "retries_exhausted")
            backoff = min(self.backoff_cap_s, self.backoff_base_s * 2 ** (attempt - 1))
            self.sleep(min(self.backoff_cap_s, max(backoff, delay or 0.0)))
        raise AssertionError("unreachable")

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> Response:
        hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
        url = self._upgrade(url)
        for _ in range(self.max_redirects + 1):
            resp = self._send(url, hdrs)
            if resp.status in (301, 302, 303, 307, 308) and resp.header("location"):
                url = self._upgrade(urljoin(url, resp.header("location") or ""))
                continue
            return resp
        raise SourceError(f"more than {self.max_redirects} redirects from {_host(url)}", "too_many_redirects")


def _host(url: str) -> str:
    return urlsplit(url).netloc
