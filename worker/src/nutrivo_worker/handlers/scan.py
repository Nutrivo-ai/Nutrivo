"""scan (T-802, H03 step 2): a supplier's upload, held in the quarantine bucket, is scanned and then promoted.

Payload, ids only: {"document_id"}: the quarantine row app.accept_supplier_upload inserted. The bytes are read from
`quarantine/<workspace>/<request>/<file>` and given to the scanner (nutrivo_worker.scanning, ClamAV). A clean file is
copied to the documents bucket under the same object name, then app.record_scan_result('clean') inserts the promoted
row as a NEW row (the quarantine row stays as history; app.supplier_documents is insert-only, founder decision on #69)
and marks the request fulfilled. An infected file is recorded 'rejected' and never leaves quarantine. A file that
could not be scanned retries and finally fails visibly: it is never promoted (docs/18, withhold rather than guess).

Idempotent: a result already recorded is a no-op, and the copy into documents tolerates an object a crashed attempt
already wrote (the same name and bytes). Logs and progress carry ids, the outcome and the scanner's signature name,
never the file name or its contents."""
from __future__ import annotations

from typing import Any, Protocol

from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from ..scanning import Scanner, scanner_for
from .notify import payload_uuid

log = get_logger(__name__)

QUARANTINE = "quarantine"
DOCUMENTS = "documents"
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class ScanStore(Protocol):
    def quarantined_upload(self, document_id: str) -> dict[str, Any] | None: ...
    def record_scan_result(self, document_id: str, outcome: str) -> dict[str, Any]: ...


class Storage(Protocol):
    def put(self, bucket: str, path: str, body: bytes, content_type: str) -> None: ...
    def get(self, bucket: str, path: str) -> bytes: ...


def _default_storage(ctx: JobContext) -> Storage:
    from ..sources.store import StorageClient

    return StorageClient(*ctx.settings.require_storage())


def run(job: Job, ctx: JobContext, *, store: ScanStore | None = None, storage: Storage | None = None,
        scanner: Scanner | None = None) -> dict[str, Any]:
    document_id = payload_uuid(job.payload.get("document_id"), "document_id")
    store = store or ctx.store  # type: ignore[assignment]  # PgStore implements ScanStore
    doc = store.quarantined_upload(document_id)
    if doc is None:
        raise PermanentJobError(f"document {document_id} does not exist")
    if not job.workspace_id or doc["workspace_id"] != job.workspace_id:
        raise PermanentJobError(f"document {document_id} belongs to another workspace")
    if (doc["uploaded_via"] != "supplier_link" or doc["scan_status"] != "quarantine" or doc["promoted_from"]
            or not doc["request_id"] or not str(doc["storage_path"]).startswith(f"{QUARANTINE}/")):
        raise PermanentJobError(f"document {document_id} is not a quarantined supplier upload")
    if doc["result_id"]:
        return _finish(ctx, document_id, "already_recorded", doc["result_id"])

    path = str(doc["storage_path"])[len(QUARANTINE) + 1:]
    parts = path.split("/")
    if len(parts) != 3 or parts[0] != doc["workspace_id"] or parts[1] != doc["request_id"]:
        raise PermanentJobError(f"document {document_id} is not stored in its request's folder")
    content_type = CONTENT_TYPES.get(parts[2].rsplit(".", 1)[-1].lower())
    if content_type is None:
        raise PermanentJobError(f"document {document_id} has a file type the upload function does not accept")

    storage = storage or _default_storage(ctx)
    scanner = scanner or scanner_for(ctx.settings)
    data = storage.get(QUARANTINE, path)
    result = scanner.scan(data)                     # ScanError retries; it never passes
    ctx.heartbeat(stage="scanned", verdict=result.verdict, scanner=scanner.name)
    if result.verdict == "clean":
        storage.put(DOCUMENTS, path, data, content_type)
        recorded = store.record_scan_result(document_id, "clean")
        return _finish(ctx, document_id, "promoted", recorded["document_id"], scanner=scanner.name)
    recorded = store.record_scan_result(document_id, "rejected")
    log.warning("supplier upload rejected by the malware scan",
                extra=kv(document_id=document_id, result_id=recorded["document_id"], signature=result.signature))
    return _finish(ctx, document_id, "rejected", recorded["document_id"], scanner=scanner.name,
                   signature=result.signature)


def _finish(ctx: JobContext, document_id: str, outcome: str, result_id: str, **extra: Any) -> dict[str, Any]:
    progress = {"stage": "done", "outcome": outcome, "result_document_id": result_id,
                **{k: v for k, v in extra.items() if v is not None}}
    ctx.heartbeat(**progress)
    log.info("scan finished", extra=kv(document_id=document_id, **progress))
    return progress


@handler("scan")
def scan(job: Job, ctx: JobContext) -> None:
    run(job, ctx)
