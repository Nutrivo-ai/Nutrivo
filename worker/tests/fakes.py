"""In-memory stand-ins for the database and providers, so the job and model logic is tested without Postgres."""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from nutrivo_worker.jobs import Claim, Job, Message, Reaped
from nutrivo_worker.mail import Email, MailError
from nutrivo_worker.models import Raw

MARKER = "hunter2"


def fake_secret(prefix: str = "") -> str:
    """A placeholder secret assembled at runtime, so the repository's secret scan never sees a key-shaped literal."""
    return prefix + MARKER


def fake_jwt() -> str:
    return ".".join(["ey" + "J" + "a" * 20, "ey" + "J" + "b" * 20, "c" * 20])


@dataclass
class FakeJob:
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    status: str = "queued"
    attempts: int = 0
    last_error: str | None = None
    stale: bool = False
    workspace_id: str | None = None
    progress: dict[str, Any] = field(default_factory=dict)


class FakeStore:
    def __init__(self) -> None:
        self.jobs: dict[str, FakeJob] = {}
        self.queue: dict[int, Message] = {}
        self.vt: dict[int, int] = {}
        self.archived: list[int] = []
        self.deleted: list[int] = []
        self.model_calls: list[dict[str, Any]] = []
        self.invitations: dict[str, dict[str, Any]] = {}
        self.memberships: dict[str, dict[str, Any]] = {}
        self.sessions: list[dict[str, Any]] = []      # {"user_id", "created_at"}
        # notify (O01): what the PgStore queries would return, keyed by id, and the rows written
        self.prefs: dict[tuple[str, str, str], bool] = {}          # (person_id, kind, channel) -> enabled
        self.members: set[str] = set()                             # active members of every test workspace
        self.notifications: list[dict[str, Any]] = []
        self.shares: dict[str, dict[str, Any]] = {}
        self.reports: dict[str, dict[str, Any]] = {}
        self.diffs: dict[str, dict[str, Any]] = {}
        self.affected: dict[str, list[dict[str, Any]]] = {}       # rule_diff_id -> recipient rows
        self.documents: dict[str, dict[str, Any]] = {}
        self.people: list[dict[str, Any]] = []                     # {"person_id", "email", "role"}
        self.allowances: dict[str, dict[str, Any]] = {}
        self.payments: dict[str, dict[str, Any]] = {}
        self.pdfs: dict[str, bytes] = {}
        self._ids = itertools.count(1)

    def add(self, job_id: str, kind: str = "notify", **kw: Any) -> Message:
        self.jobs[job_id] = FakeJob(kind, **kw)
        return self.send(kind, {"job_id": job_id})

    def send(self, kind: str, body: dict[str, Any]) -> Message:
        msg = Message(next(self._ids), kind, body)
        self.queue[msg.msg_id] = msg
        return msg

    def read(self, kind: str, vt_s: int, qty: int) -> list[Message]:
        out = [m for m in self.queue.values() if m.kind == kind and self.vt.get(m.msg_id, 0) == 0][:qty]
        for m in out:
            self.vt[m.msg_id] = vt_s
        return out

    def claim(self, job_id: str, stale_after_s: int) -> Claim:
        j = self.jobs.get(job_id)
        if j is None:
            return Claim("missing")
        if j.status == "queued" or (j.status == "running" and j.stale):
            j.status, j.attempts, j.stale = "running", j.attempts + 1, False
            return Claim("claimed", Job(job_id, j.kind, j.workspace_id, j.payload, j.attempts))
        return Claim("busy" if j.status == "running" else j.status)  # type: ignore[arg-type]

    def heartbeat(self, job_id: str, progress: dict[str, Any] | None) -> None:
        self.jobs[job_id].progress.update(progress or {})

    def succeed(self, job_id: str) -> None:
        self.jobs[job_id].status, self.jobs[job_id].last_error = "succeeded", None

    def retry(self, job_id: str, error: str) -> None:
        self.jobs[job_id].status, self.jobs[job_id].last_error = "queued", error

    def fail(self, job_id: str, error: str) -> None:
        self.jobs[job_id].status, self.jobs[job_id].last_error = "failed", error

    def set_vt(self, kind: str, msg_id: int, vt_s: int) -> None:
        self.vt[msg_id] = vt_s

    def delete(self, kind: str, msg_id: int) -> None:
        self.queue.pop(msg_id)
        self.deleted.append(msg_id)

    def archive(self, kind: str, msg_id: int) -> None:
        self.queue.pop(msg_id)
        self.archived.append(msg_id)

    def reap(self, stale_after_s: int, max_attempts: int) -> list[Reaped]:
        out = []
        for job_id, j in self.jobs.items():
            if j.status == "running" and j.stale:
                j.status = "failed" if j.attempts >= max_attempts else "queued"
                j.stale = False
                if j.status == "queued":
                    self.send(j.kind, {"job_id": job_id})
                out.append(Reaped(job_id, j.kind, j.status, j.attempts))
        return out

    def insert_model_call(self, row: dict[str, Any]) -> None:
        self.model_calls.append(row)

    def job_progress(self, job_id: str) -> dict[str, Any]:
        return dict(self.jobs[job_id].progress)

    def invitation_for_email(self, invitation_id: str) -> dict[str, Any] | None:
        inv = self.invitations.get(invitation_id)
        return {k: v for k, v in inv.items() if k != "token_hash"} if inv else None

    def set_invitation_token(self, invitation_id: str, token_hash: bytes) -> bool:
        inv = self.invitations[invitation_id]
        if inv["accepted_at"] or inv["revoked_at"] or inv["expires_at"] <= datetime.now(UTC):
            return False
        inv["token_hash"] = token_hash
        return True

    def notification_prefs(self, person_ids: list[str], kind: str) -> dict[tuple[str, str], bool]:
        return {(p, ch): on for (p, k, ch), on in self.prefs.items() if k == kind and p in person_ids}

    def insert_notifications(self, job_id: str, workspace_id: str, kind: str, severity: str,
                             rows: list[tuple[str, dict[str, Any]]]) -> int:
        new = [{"workspace_id": workspace_id, "person_id": p, "kind": kind, "severity": severity, "object_ref": ref,
                "read_at": None} for p, ref in rows if p in self.members]
        self.notifications += new
        self.jobs[job_id].progress["in_app"] = len(new)        # the same transaction as the rows
        return len(new)

    def share_for_email(self, share_id: str) -> dict[str, Any] | None:
        share = self.shares.get(share_id)
        return {k: v for k, v in share.items() if k != "token_hash"} if share else None

    def set_share_token(self, share_id: str, token_hash: bytes) -> bool:
        share = self.shares[share_id]
        if share["revoked_at"] or (share["expires_at"] and share["expires_at"] <= datetime.now(UTC)):
            return False
        share["token_hash"] = token_hash
        return True

    def report_summary(self, report_id: str) -> dict[str, Any] | None:
        return self.reports.get(report_id)

    def rule_diff(self, rule_diff_id: str) -> dict[str, Any] | None:
        return self.diffs.get(rule_diff_id)

    def rule_change_recipients(self, rule_diff_id: str, workspace_id: str) -> list[dict[str, Any]]:
        return [r for r in self.affected.get(rule_diff_id, []) if r["person_id"] in self.members]

    def document_for_notice(self, document_id: str) -> dict[str, Any] | None:
        return self.documents.get(document_id)

    def members_for_notice(self, workspace_id: str, person_ids: list[str], admins: bool) -> list[dict[str, Any]]:
        return [{"person_id": p["person_id"], "email": p["email"]} for p in self.people
                if p["person_id"] in self.members and (p["person_id"] in person_ids or (admins and p["role"] == "admin"))]

    def allowance_for_notice(self, workspace_id: str) -> dict[str, Any] | None:
        return self.allowances.get(workspace_id)

    def payment_for_receipt(self, payment_event_id: str) -> dict[str, Any] | None:
        return self.payments.get(payment_event_id)

    def invoice_pdf(self, payment_event_id: str) -> bytes | None:
        return self.pdfs.get(payment_event_id)

    def membership_for_revoke(self, membership_id: str) -> dict[str, Any] | None:
        return self.memberships.get(membership_id)

    def revoke_sessions(self, user_id: str, created_before: Any) -> int:
        gone = [x for x in self.sessions if x["user_id"] == user_id and x["created_at"] <= created_before]
        self.sessions = [x for x in self.sessions if x not in gone]
        return len(gone)


class FakeMailer:
    def __init__(self, fail: int = 0):
        self.sent: list[Email] = []
        self.fail = fail

    def send(self, email: Email) -> str | None:
        if self.fail:
            self.fail -= 1
            raise MailError(f"Mailpit refused the {email.template} email (URLError)")
        self.sent.append(email)
        return f"msg-{len(self.sent)}"


class FakeProvider:
    def __init__(self, name: str = "bedrock", text: str | None = '{"answer": "OK"}', stop_reason: str = "end_turn",
                 fail: int = 0, models: dict[str, str] | None = None):
        self.name, self.text, self.stop_reason, self.fail = name, text, stop_reason, fail
        self.models = models if models is not None else {"judgement": "eu.judge", "triage": "eu.triage",
                                                         "extraction": "eu.extract"}
        self.calls: list[dict[str, Any]] = []

    def model_for(self, model_class: str) -> str | None:
        return self.models.get(model_class)

    def complete(self, model_id: str, system: str, user: str, schema: dict, max_tokens: int) -> Raw:
        self.calls.append({"model_id": model_id, "system": system, "user": user, "schema": schema})
        if self.fail:
            self.fail -= 1
            raise ConnectionError("provider down")
        return Raw(self.name, model_id, self.text, self.stop_reason, 120, 8)
