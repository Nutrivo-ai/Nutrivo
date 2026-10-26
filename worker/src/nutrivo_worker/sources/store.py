"""Where fetched texts go: the private 'sources' bucket, content-addressed, and one ref.sources row per distinct body.

Idempotent by (kind, celex, language, sha256) for EUR-Lex texts and by (kind, url, sha256) for register pulls: the
same bytes again give `unchanged` and no new row. The object is uploaded before the row is inserted, so a row never
points at a missing object; an object already present under its own hash is the same bytes and counts as uploaded. ref.sources is staff tooling (service role only) and carries no
status: nothing here accepts anything."""
from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, Protocol
from urllib.parse import quote

from psycopg.rows import dict_row

from ..errors import SafeError
from .eurlex import Document
from .http import Transport, TransportError, UrllibTransport

if TYPE_CHECKING:
    from .register import Pull

BUCKET = "sources"


class StorageError(SafeError):
    reason = "storage_error"

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Meta:
    title: str
    licence: str = "eu_reuse"


Stored = tuple[Literal["stored", "unchanged"], str]


class SourceStore(Protocol):
    def save(self, doc: Document, meta: Meta, retrieved_at: datetime) -> Stored: ...


class PullStore(Protocol):
    def save_pull(self, pull: Pull, meta: Meta, retrieved_at: datetime) -> Stored: ...


def storage_path(doc: Document) -> str:
    """The object's path inside the 'sources' bucket, as ref.sources.storage_path holds it."""
    return f"eurlex/{doc.celex}/{doc.language}/{doc.sha256}.xhtml"


def pull_path(pull: Pull) -> str:
    """A register pull's path inside the 'sources' bucket: `register/{register}/{endpoint}/{sha256}.json`."""
    return f"register/{pull.register}/{pull.name}/{pull.sha256}.json"


class StorageClient:
    """Supabase Storage over its REST API with the service role key (worker only)."""

    def __init__(self, url: str, service_key: str, transport: Transport | None = None):
        self.url, self._key = url.rstrip("/"), service_key
        self.transport = transport or UrllibTransport(timeout_s=120)

    def put(self, bucket: str, path: str, body: bytes, content_type: str) -> None:
        headers: Mapping[str, str] = {"Authorization": f"Bearer {self._key}", "apikey": self._key,
                                      "Content-Type": content_type, "x-upsert": "false"}
        resp = self.transport.send("POST", f"{self.url}/storage/v1/object/{bucket}/{quote(path)}", headers, body)
        if resp.status in (200, 201):
            return
        if resp.status in (400, 409) and _already_exists(resp.body):
            return
        raise StorageError(f"storage upload to {bucket} answered HTTP {resp.status}", resp.status)

    def get_if_exists(self, bucket: str, path: str, **kw: Any) -> bytes | None:
        """Like get, but None when the object does not exist (Storage answers 400 or 404 for a missing object)."""
        try:
            return self.get(bucket, path, **kw)
        except StorageError as exc:
            if exc.status in (400, 404):
                return None
            raise

    def get(self, bucket: str, path: str, *, attempts: int = 3,
            sleep: Callable[[float], None] = time.sleep) -> bytes:
        """A stored object's bytes. Network errors and 5xx retry with backoff, `attempts` times in all."""
        headers: Mapping[str, str] = {"Authorization": f"Bearer {self._key}", "apikey": self._key}
        url = f"{self.url}/storage/v1/object/authenticated/{bucket}/{quote(path)}"
        last, status = "no attempt", None
        for attempt in range(attempts):
            if attempt:
                sleep(2.0 ** (attempt - 1))
            try:
                resp = self.transport.send("GET", url, headers)
            except TransportError as exc:
                last = str(exc)
                continue
            if resp.status == 200:
                return resp.body
            last, status = f"HTTP {resp.status}", resp.status
            if resp.status < 500:
                break
        raise StorageError(f"storage read from {bucket} failed ({last})", status)


def _already_exists(body: bytes) -> bool:
    try:
        err = json.loads(body)
    except ValueError:
        return False
    return str(err.get("statusCode")) == "409" or err.get("error") == "Duplicate"


class PgSourceStore:
    def __init__(self, conn, storage: StorageClient):  # type: ignore[no-untyped-def]
        self.conn, self.storage = conn, storage

    def save(self, doc: Document, meta: Meta, retrieved_at: datetime) -> Stored:
        path = storage_path(doc)
        with self.conn.transaction(), self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (f"ref.sources:eurlex:{doc.celex}:{doc.language}:{doc.sha256}",))
            row = cur.execute("""select id from ref.sources where kind = 'eurlex' and celex = %s and language = %s
                                  and sha256 = %s order by created_at limit 1""",
                              (doc.celex, doc.language, doc.sha256)).fetchone()
            if row:
                return "unchanged", str(row["id"])
            self.storage.put(BUCKET, path, doc.body, doc.content_type)
            row = cur.execute(
                """insert into ref.sources (kind, celex, title, url, language, licence, retrieved_at, sha256,
                                            storage_path)
                   values ('eurlex', %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                (doc.celex, meta.title, doc.url, doc.language, meta.licence, retrieved_at, doc.sha256, path)
            ).fetchone()
            return "stored", str(row["id"])

    def save_pull(self, pull: Pull, meta: Meta, retrieved_at: datetime) -> Stored:
        path = pull_path(pull)
        with self.conn.transaction(), self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (f"ref.sources:register:{pull.url}:{pull.sha256}",))
            row = cur.execute("""select id from ref.sources where kind = 'register' and url = %s and sha256 = %s
                                  order by created_at limit 1""", (pull.url, pull.sha256)).fetchone()
            if row:
                return "unchanged", str(row["id"])
            self.storage.put(BUCKET, path, pull.body, pull.content_type)
            row = cur.execute(
                """insert into ref.sources (kind, title, url, language, licence, retrieved_at, sha256, storage_path)
                   values ('register', %s, %s, %s, %s, %s, %s, %s) returning id""",
                (meta.title, pull.url, pull.language, meta.licence, retrieved_at, pull.sha256, path)
            ).fetchone()
            return "stored", str(row["id"])
