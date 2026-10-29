"""report (I01): render a check's label report PDF and record it. Payload, ids only: {"check_id"} (and the web's
request_id). One document per check, that is per market × printed language panel (Export - Label Report design).

The reference (128 random bits, base32), the ruleset version, the artwork hash and the issue time are on the face;
the Not assessed section is always present; the app.reports row is insert-only. Idempotent per job (see
nutrivo_worker.reporting.service). Progress carries ids, the reference, size and hash, never a URL: members read their
jobs, and the web signs a link to the PDF on demand."""
from __future__ import annotations

from typing import Any

from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from ..reporting import service
from ..reporting.store import PgReportStore
from .notify import payload_uuid

log = get_logger(__name__)


def _default_storage(ctx: JobContext) -> service.Storage:
    from ..sources.store import StorageClient

    return StorageClient(*ctx.settings.require_storage())


def run(job: Job, ctx: JobContext, *, storage: service.Storage | None = None,
        store: PgReportStore | None = None) -> dict[str, Any]:
    check_id = payload_uuid(job.payload.get("check_id"), "check_id")
    store = store or PgReportStore(ctx.store.conn)  # type: ignore[attr-defined]  # PgStore has a connection
    result = service.generate(store, storage or _default_storage(ctx), job_id=job.id, workspace_id=job.workspace_id,
                              check_id=check_id, heartbeat=ctx.heartbeat)
    progress: dict[str, Any] = {"stage": "ready", "outcome": result.outcome, "report_id": result.report_id,
                                "ref": result.ref, "bucket": service.BUCKET, "path": result.pdf_path,
                                "sha256": result.sha256}
    if result.bytes:
        progress["bytes"] = result.bytes
    ctx.heartbeat(**progress)
    log.info("report finished", extra=kv(outcome=result.outcome, report_id=result.report_id, check_id=check_id,
                                         bytes=result.bytes))
    return progress


@handler("report")
def report(job: Job, ctx: JobContext) -> None:
    run(job, ctx)
