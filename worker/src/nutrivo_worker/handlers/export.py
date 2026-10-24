"""O03 · Export everything (T-804): one zip of a workspace's records and files, in the private 'exports' bucket.

The job's workspace_id is the only scope: every query filters on it, and a stored file is copied only when its path
sits under that workspace's folder. The archive holds one CSV per kind of record, the report PDFs and the clean
supplier documents, and manifest.json. Every CSV carries a ruleset_version column (O03 step 1): the version the row
was pinned to, or empty where the record is not pinned to one (a recipe, a product, a supplier document).

Never gated (BE-44): nothing here reads the plan, the subscription or the workspace status, so a free, dunning,
dormant or closed workspace exports exactly as an active one does.

Idempotent: the object is `<workspace_id>/<job_id>.zip`, uploaded without upsert, so a retry after an upload that
succeeded finds it present and moves on. On success the path, size and hash go into app.jobs.progress. A signed URL
is never stored there, because every member can read their workspace's jobs; the web signs one on demand for an
admin (docs/04: exports last 7 days)."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import sentry_sdk
from psycopg import sql

from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv

log = get_logger(__name__)

BUCKET = "exports"
FORMAT = "nutrivo-export/1"
_EPOCH = (1980, 1, 1, 0, 0, 0)   # fixed zip timestamps: the same rows give the same bytes


@dataclass(frozen=True)
class Table:
    """One CSV in the archive: `select` lists the source table as t and must filter on t.workspace_id."""

    file: str
    select: str
    order: str = "t.created_at, t.id"


# What "everything" covers (docs/workflows/O03.md, design: Workspace Settings, "Take it with you"): recipes, checks,
# findings, reports, certificates and documents, with the records they hang off. Never people, memberships, billing,
# tokens or model internals.
TABLES: tuple[Table, ...] = (
    Table("recipes.csv", "select t.*, null::text as ruleset_version from app.families t"),
    Table("products.csv", "select t.*, null::text as ruleset_version from app.products t"),
    Table("product_markets.csv", "select t.* from app.product_nodes t", "t.product_id, t.node_id"),
    Table("formula_lines.csv", "select t.*, null::text as ruleset_version from app.formula_lines t",
          "t.product_id, t.position, t.id"),
    Table("intended_claims.csv", "select t.*, null::text as ruleset_version from app.intended_claims t"),
    Table("artwork_versions.csv", "select t.*, null::text as ruleset_version from app.artwork_versions t",
          "t.product_id, t.version"),
    Table("classifications.csv", "select t.*, null::text as ruleset_version from app.classifications t"),
    Table("checks.csv", "select t.* from app.checks t", "t.at, t.id"),
    Table("findings.csv", "select t.*, c.ruleset_version from app.check_findings t"
                          " join app.checks c on c.id = t.check_id and c.workspace_id = t.workspace_id"),
    Table("reports.csv", "select t.* from app.reports t"),
    Table("certificates.csv", "select t.*, r.ruleset_version from app.certificates t"
                              " join app.reports r on r.id = t.report_id and r.workspace_id = t.workspace_id",
          "t.signed_at, t.id"),
    Table("registrations.csv", "select t.*, null::text as ruleset_version from app.registrations t"),
    Table("suppliers.csv", "select t.*, null::text as ruleset_version from app.suppliers t"),
    Table("documents.csv", "select t.*, null::text as ruleset_version from app.supplier_documents t"),
)


class Reader(Protocol):
    def rows(self, table: Table, workspace_id: str) -> tuple[list[str], list[dict[str, Any]]]: ...
    def files(self, workspace_id: str) -> list[tuple[str, str, str]]: ...


class Storage(Protocol):
    def put(self, bucket: str, path: str, body: bytes, content_type: str) -> None: ...
    def get_if_exists(self, bucket: str, path: str) -> bytes | None: ...


class PgReader:
    """Reads one workspace's rows over the worker's connection (service role: RLS is not what scopes this, the
    workspace_id filter on every statement is)."""

    def __init__(self, conn: Any):
        self.conn = conn

    def rows(self, table: Table, workspace_id: str) -> tuple[list[str], list[dict[str, Any]]]:
        """The column names (so an empty table still gets its header) and the rows."""
        query = sql.SQL(table.select + " where t.workspace_id = %s order by " + table.order)  # type: ignore[arg-type]
        cur = self.conn.execute(query, (workspace_id,))
        return [d.name for d in cur.description or []], list(cur.fetchall())

    def files(self, workspace_id: str) -> list[tuple[str, str, str]]:
        """(bucket, storage path, archive name) for each stored file the archive copies."""
        rows = self.conn.execute(
            """select 'reports' as bucket, pdf_path as path, 'reports/' || id || '.pdf' as name
                 from app.reports where workspace_id = %(ws)s and pdf_path is not null
               union all
               select 'documents', storage_path,
                      'documents/' || id || coalesce(substring(storage_path from '(\\.[A-Za-z0-9]{1,8})$'), '')
                 from app.supplier_documents where workspace_id = %(ws)s and scan_status = 'clean'
               order by 3""", {"ws": workspace_id}).fetchall()
        return [(r["bucket"], r["path"], r["name"]) for r in rows]


def object_path(bucket: str, path: str, workspace_id: str) -> str | None:
    """The path inside `bucket`, or None when it is not under this workspace's folder (docs/04: paths start with the
    workspace id; a leading bucket name is tolerated)."""
    path = path.lstrip("/")
    if path.startswith(bucket + "/"):
        path = path[len(bucket) + 1:]
    return path if path.startswith(workspace_id + "/") and ".." not in path.split("/") else None


def archive_path(workspace_id: str, job_id: str) -> str:
    return f"{workspace_id}/{job_id}.zip"


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def to_csv(columns: Iterable[str], rows: Iterable[Mapping[str, Any]]) -> bytes:
    columns = [c for c in dict.fromkeys(columns) if c != "ruleset_version"] + ["ruleset_version"]  # last, every file
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_cell(row.get(c)) for c in columns])
    return out.getvalue().encode("utf-8")


def _add(zf: zipfile.ZipFile, name: str, body: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=_EPOCH)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, body)


def build_archive(job: Job, reader: Reader, storage: Storage,
                  progress: Callable[..., None] = lambda **_: None) -> tuple[bytes, dict[str, Any]]:
    """The zip and its manifest. Deterministic for the same rows and files."""
    ws = job.workspace_id
    assert ws is not None
    counts: dict[str, int] = {}
    files: list[str] = []
    missing: list[str] = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for table in TABLES:
            with sentry_sdk.start_span(op="export.table", name=table.file):
                columns, rows = reader.rows(table, ws)
            _add(zf, table.file, to_csv(columns, rows))
            counts[table.file] = len(rows)
            progress(stage="records", tables_done=len(counts), tables=len(TABLES))
        for bucket, path, name in reader.files(ws):
            obj = object_path(bucket, path, ws)
            body = None
            if obj is not None:
                with sentry_sdk.start_span(op="export.file", name=bucket):
                    body = storage.get_if_exists(bucket, obj)
            if body is None:                       # outside the workspace's folder, or gone: listed, never guessed
                missing.append(name)
                continue
            _add(zf, name, body)
            files.append(name)
            progress(stage="files", files_done=len(files) + len(missing))
        manifest = {
            "format": FORMAT,
            "workspace_id": ws,
            "job_id": job.id,
            "request_id": job.request_id,
            "records": counts,
            "files": files,
            "files_missing": missing,
            "ruleset_version": "Every CSV has a ruleset_version column: the version the row was pinned to, "
                               "empty where the record is not pinned to one (recipes, products, documents).",
        }
        _add(zf, "manifest.json", json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"))
    return buf.getvalue(), manifest


StorageFactory = Callable[[JobContext], Storage]


def _default_storage(ctx: JobContext) -> Storage:
    from ..sources.store import StorageClient

    return StorageClient(*ctx.settings.require_storage())


def run(job: Job, ctx: JobContext, *, storage: Storage | None = None, reader: Reader | None = None) -> dict[str, Any]:
    if not job.workspace_id:
        raise PermanentJobError("export job has no workspace_id")
    storage = storage or _default_storage(ctx)
    reader = reader or PgReader(ctx.store.conn)  # type: ignore[attr-defined]  # PgStore
    body, manifest = build_archive(job, reader, storage, ctx.heartbeat)
    path = archive_path(job.workspace_id, job.id)
    with sentry_sdk.start_span(op="export.upload", name=BUCKET):
        storage.put(BUCKET, path, body, "application/zip")
    result = {"stage": "ready", "bucket": BUCKET, "path": path, "bytes": len(body),
              "sha256": hashlib.sha256(body).hexdigest(), "files_missing": len(manifest["files_missing"])}
    ctx.heartbeat(**result)
    log.info("export written", extra=kv(bytes=len(body), records=sum(manifest["records"].values()),
                                        files=len(manifest["files"]), files_missing=len(manifest["files_missing"])))
    return result


@handler("export")
def export(job: Job, ctx: JobContext) -> None:
    run(job, ctx)
