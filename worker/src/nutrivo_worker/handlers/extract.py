"""The `extract` job (D01, T-303): the registered artwork's file through the T-302 engine into app.extraction_runs,
app.artwork_panels and app.text_objects, exactly to the docs/06 contract.

- **Input.** The payload holds `artwork_version_id` only (app.register_artwork). The row gives the storage path and
  the hash the browser computed; the bytes are read from the private 'artwork' bucket with the service role and must
  hash to it.
- **Raster uploads.** A PNG or JPEG never reaches pdfium: it has no physical scale and no text, so it is one panel,
  not_assessable 'rasterised', with no geometry (bbox [0, 0, 0, 0], no page size). Geometry is never guessed
  (D01.fail.1).
- **Partial results (BE-18).** Every failure the engine finds is a named panel status. Only a missing object or a hash
  mismatch fails the job, as a PermanentJobError with ids only; a storage outage retries within the runtime's bounds.
- **Idempotency.** One extraction run per (artwork version, engine): its key is the engine's key plus the artwork
  version id, and the run, its panels and their text objects are written in one transaction that inserts the run
  first with `on conflict do nothing`. A retry, a duplicate message or a reaped job finds the run and writes nothing.
- **Observability.** The job's Sentry transaction and Langfuse trace come from the runtime; progress goes to
  app.jobs.progress through ctx.heartbeat (stage and counts, never label text)."""
from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import psycopg
import sentry_sdk

from ..errors import PermanentJobError
from ..extraction import ENGINE, ExtractionResult, Panel, engine_version, extract_artwork, idempotency_key
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from ..sources.store import StorageClient, StorageError

log = get_logger(__name__)

BUCKET = "artwork"
PNG = b"\x89PNG\r\n\x1a\n"
JPEG = b"\xff\xd8\xff"


@dataclass(frozen=True)
class Artwork:
    id: str
    workspace_id: str
    product_id: str
    file_sha256: str
    storage_path: str


class ArtworkStore(Protocol):
    """The database side of the handler; PgArtworkStore implements it, tests may use a fake."""

    def artwork(self, artwork_version_id: str) -> Artwork | None: ...
    def run_for(self, key: str) -> dict[str, Any] | None: ...
    def persist(self, art: Artwork, key: str, result: ExtractionResult, started_at: datetime) -> dict[str, Any]: ...


def file_kind(data: bytes) -> str:
    """What the bytes are, by their magic numbers, never by the name or the MIME type the browser sent."""
    if data.startswith((PNG, JPEG)):
        return "raster"
    return "pdf"     # anything else goes to the engine, which names an unopenable file 'unreadable'


def raster_result(sha: str) -> ExtractionResult:
    """A photo or flat image: one not-assessable panel and no geometry, so no height can ever be read from it."""
    result = ExtractionResult(sha, idempotency_key(sha), ENGINE, engine_version(), [], [])
    result.panels.append(Panel(0, 0, [0.0, 0.0, 0.0, 0.0], "und", None, "not_assessable", "rasterised"))
    return result


def extract_bytes(data: bytes) -> ExtractionResult:
    sha = hashlib.sha256(data).hexdigest()
    if file_kind(data) == "raster":
        return raster_result(sha)
    with tempfile.TemporaryDirectory(prefix="nutrivo-extract-") as tmp:
        path = Path(tmp) / "artwork.pdf"
        path.write_bytes(data)
        return extract_artwork(path)


def run_key(artwork_version_id: str, sha: str) -> str:
    """extraction_runs.idempotency_key: the engine's key (file and engine versions) for this artwork version."""
    return f"{idempotency_key(sha)}:{artwork_version_id}"


def summary(run: dict[str, Any]) -> dict[str, Any]:
    return {"stage": "done", "extraction_run_id": str(run["id"]), "status": run["status"],
            "panels": run["panels"], "panels_extracted": run["panels_extracted"],
            "text_objects": run["text_objects"], "failure_codes": list(run["failure_codes"])}


def run_extract(job: Job, ctx: JobContext, store: ArtworkStore, fetch: Any) -> dict[str, Any]:
    av_id = job.payload.get("artwork_version_id")
    if not av_id:
        raise PermanentJobError(f"extract job {job.id} has no artwork_version_id")
    art = store.artwork(str(av_id))
    if art is None:
        raise PermanentJobError(f"artwork version {av_id} not found")
    sentry_sdk.set_tag("artwork_version_id", art.id)
    key = run_key(art.id, art.file_sha256)
    done = store.run_for(key)
    if done is not None:                     # already persisted by an earlier attempt or a duplicate job
        log.info("extraction already persisted", extra=kv(artwork_version_id=art.id, extraction_run_id=done["id"]))
        ctx.heartbeat(**summary(done))
        return done

    started_at = datetime.now(UTC)
    ctx.heartbeat(stage="reading", artwork_version_id=art.id)
    try:
        data = fetch(BUCKET, art.storage_path)
    except StorageError as exc:
        if "HTTP 4" in str(exc):             # 400/404: the object is not there, and retrying will not bring it
            raise PermanentJobError(f"artwork version {art.id}: the file is missing from storage") from exc
        raise                                # a storage outage: the runtime retries with backoff
    if hashlib.sha256(data).hexdigest() != art.file_sha256:
        raise PermanentJobError(f"artwork version {art.id}: the stored file does not match its registered hash")

    ctx.heartbeat(stage="extracting")
    result = extract_bytes(data)
    ctx.heartbeat(stage="saving", pages=len(result.page_size_mm), panels=len(result.panels))
    run = store.persist(art, key, result, started_at)
    log.info("extraction persisted", extra=kv(artwork_version_id=art.id, extraction_run_id=run["id"],
                                              status=run["status"], panels=run["panels"],
                                              failure_codes=list(run["failure_codes"])))
    ctx.heartbeat(**summary(run))
    return run


class PgArtworkStore:
    def __init__(self, conn):  # type: ignore[no-untyped-def]
        self.conn = conn

    def artwork(self, artwork_version_id: str) -> Artwork | None:
        try:
            row = self.conn.execute(
                """select id, workspace_id, product_id, file_sha256, storage_path from app.artwork_versions
                    where id = %s""", (artwork_version_id,)).fetchone()
        except psycopg.errors.InvalidTextRepresentation:     # not a uuid
            return None
        if row is None:
            return None
        return Artwork(str(row["id"]), str(row["workspace_id"]), str(row["product_id"]), row["file_sha256"],
                       row["storage_path"])

    _RUN = """select r.id, r.status, r.failure_codes,
                     (select count(*) from app.artwork_panels p where p.extraction_run_id = r.id)::int as panels,
                     (select count(*) from app.artwork_panels p where p.extraction_run_id = r.id
                         and p.status = 'extracted')::int as panels_extracted,
                     (select count(*) from app.text_objects t join app.artwork_panels p on p.id = t.panel_id
                       where p.extraction_run_id = r.id)::int as text_objects
                from app.extraction_runs r where r.idempotency_key = %s"""

    def run_for(self, key: str) -> dict[str, Any] | None:
        return self.conn.execute(self._RUN, (key,)).fetchone()

    def persist(self, art: Artwork, key: str, result: ExtractionResult, started_at: datetime) -> dict[str, Any]:
        with self.conn.transaction():
            row = self.conn.execute(
                """insert into app.extraction_runs (workspace_id, product_id, artwork_version_id, engine,
                                                    engine_version, status, failure_codes, idempotency_key,
                                                    started_at, finished_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                   on conflict (idempotency_key) do nothing returning id""",
                (art.workspace_id, art.product_id, art.id, result.engine, result.engine_version, result.status,
                 result.failure_codes, key, started_at)).fetchone()
            if row is not None:              # this attempt owns the run: write its panels and text objects
                for panel in result.panels:
                    self._panel(art, row["id"], panel)
                sizes = [[round(w, 3), round(h, 3)] for w, h in result.page_size_mm]
                self.conn.execute(
                    """update app.artwork_versions set page_count = %s, page_size_mm = %s where id = %s""",
                    (len(sizes) or None, sizes[0] if sizes else None, art.id))
        return self.run_for(key)

    def _panel(self, art: Artwork, run_id: Any, panel: Panel) -> None:
        pid = self.conn.execute(
            """insert into app.artwork_panels (workspace_id, product_id, artwork_version_id, extraction_run_id, page,
                                               panel_index, bbox_mm, language, language_confidence, status,
                                               failure_code)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
            (art.workspace_id, art.product_id, art.id, run_id, panel.page, panel.index, panel.bbox_mm,
             panel.language, panel.language_confidence, panel.status, panel.failure_code)).fetchone()["id"]
        if not panel.text_objects:
            return
        with self.conn.cursor() as cur:
            cur.executemany(
                """insert into app.text_objects (workspace_id, product_id, panel_id, text, bbox_mm, font_name,
                                                 font_size_pt, x_height_mm, cap_height_mm, is_ocr, confidence,
                                                 reading_order)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [(art.workspace_id, art.product_id, pid, t.text, t.bbox_mm, t.font_name, t.font_size_pt,
                  t.x_height_mm, t.cap_height_mm, t.is_ocr, t.confidence, order)
                 for order, t in enumerate(panel.text_objects)])


@handler("extract")
def extract(job: Job, ctx: JobContext) -> None:
    conn = getattr(ctx.store, "conn", None)
    if conn is None:
        raise PermanentJobError("the extract handler needs the Postgres store")
    storage = StorageClient(*ctx.settings.require_storage())
    run_extract(job, ctx, PgArtworkStore(conn), storage.get)
