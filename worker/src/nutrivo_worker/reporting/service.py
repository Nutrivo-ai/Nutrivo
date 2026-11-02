"""Generate a label report for a check, and re-render one by its reference (I01, BE-26).

generate() is idempotent per job. The reference and issue time are minted once and kept in app.jobs.progress before
anything is rendered, so a retry prints the same reference. The model is stored before the PDF, and a retry that finds
it renders the stored model instead of reading the snapshot again. The upload never overwrites: a PDF already stored
under the reference must hash to what the stored model renders to, or the job fails rather than issue two documents
under one reference. The app.reports row and its audit event are written last, in one transaction."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import sentry_sdk

from ..errors import PermanentJobError
from . import model as m
from .render import render
from .store import PgReportStore

BUCKET = "reports"


class Storage(Protocol):
    def put(self, bucket: str, path: str, body: bytes, content_type: str) -> None: ...
    def get_if_exists(self, bucket: str, path: str) -> bytes | None: ...


@dataclass(frozen=True)
class Generated:
    outcome: str                  # generated · already_generated
    report_id: str
    ref: str
    pdf_path: str
    sha256: str
    bytes: int


def pdf_path(workspace_id: str, product_id: str, ref: str) -> str:
    return f"{workspace_id}/{product_id}/{ref}.pdf"


def model_path(pdf: str) -> str:
    return pdf.removesuffix(".pdf") + ".json"


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def generate(store: PgReportStore, storage: Storage, *, job_id: str, workspace_id: str | None, check_id: str,
             heartbeat: Any = lambda **_: None) -> Generated:
    existing = store.report_for_job(job_id)
    if existing is not None:
        return Generated("already_generated", str(existing["id"]), existing["ref"], existing["pdf_path"],
                         existing["pdf_sha256"], 0)
    check = store.check(check_id)
    if check is None or str(check["workspace_id"]) != workspace_id:
        raise PermanentJobError("report job names no check of its workspace")
    job = store.job(job_id) or {}
    progress, requested_by = job.get("progress") or {}, job.get("requested_by")
    ref, issued_raw = progress.get("ref"), progress.get("issued_at")
    if not ref or not issued_raw:
        ref, issued_at = m.new_reference(), m.issue_time()
        heartbeat(stage="rendering", ref=ref, issued_at=m.iso(issued_at))
    else:
        issued_at = datetime.strptime(issued_raw, "%Y-%m-%dT%H:%M:%S%z")
    path = pdf_path(str(check["workspace_id"]), str(check["product_id"]), ref)

    stored_model = storage.get_if_exists(BUCKET, model_path(path))
    if stored_model is not None:
        doc = json.loads(stored_model)
        if doc.get("ref") != ref or doc.get("check_ids") != [str(check["id"])]:
            raise PermanentJobError("stored report model does not match the job")
    else:
        with sentry_sdk.start_span(op="report.model", name="label_report"):
            events = store.events(check)
            doc = m.build(events, store.snapshot(check, events, requested_by), ref=ref, issued_at=issued_at,
                          workspace_id=str(check["workspace_id"]))
        storage.put(BUCKET, model_path(path), m.dumps(doc), "application/json")
    with sentry_sdk.start_span(op="report.render", name=doc["template"]):
        pdf = render(doc)
    digest = sha256(pdf)
    stored_pdf = storage.get_if_exists(BUCKET, path)
    if stored_pdf is None:
        with sentry_sdk.start_span(op="report.upload", name=BUCKET):
            storage.put(BUCKET, path, pdf, "application/pdf")
    elif sha256(stored_pdf) != digest:
        raise PermanentJobError("a different PDF is already stored under this reference")
    report_id = store.insert(doc, product_id=check["product_id"], job_id=job_id, created_by=requested_by,
                             issued_at=issued_at, pdf_path=path, pdf_sha256=digest)
    return Generated("generated", report_id, ref, path, digest, len(pdf))


@dataclass(frozen=True)
class Rerendered:
    ref: str
    identical: bool               # the re-rendered bytes hash to app.reports.pdf_sha256
    pinned_match: bool            # the stored model's pinned part still equals what the check events give
    sha256: str
    expected_sha256: str
    pdf: bytes


class ReportNotFound(LookupError):
    pass


def rerender(store: PgReportStore, storage: Storage, ref: str) -> Rerendered:
    """Re-render the document a reference names, from its stored model, and compare it with what was issued."""
    row = store.report_by_ref(ref)
    if row is None or not row["pdf_path"]:
        raise ReportNotFound(ref)
    body = storage.get_if_exists(BUCKET, model_path(row["pdf_path"]))
    if body is None:
        raise ReportNotFound(f"{ref}: model missing")
    doc = json.loads(body)
    header_match = (doc["ref"] == row["ref"] and doc["check_ids"] == [str(c) for c in row["check_ids"]]
                    and doc["ruleset_version"] == row["ruleset_version"] and doc["artwork_sha"] == row["artwork_sha"]
                    and doc["has_not_assessed"] == row["has_not_assessed"]
                    and doc["workspace_id"] == str(row["workspace_id"]) and doc["issued_at"] == m.iso(row["created_at"]))
    check = store.check(doc["check_ids"][0])
    pinned_match = header_match and check is not None and m.pinned_part(store.events(check)) == doc["pinned"]
    pdf = render(doc)
    digest = sha256(pdf)
    return Rerendered(ref, digest == row["pdf_sha256"], pinned_match, digest, row["pdf_sha256"], pdf)
