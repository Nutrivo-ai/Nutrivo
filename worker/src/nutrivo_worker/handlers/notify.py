"""notify: transactional email. Template `invitation` (A03): mint the invitation token, store only its hash, email it.

The payload holds ids only ({"template", "invitation_id"}); the token exists in this process's memory and in the
email, nowhere else (docs/09). Idempotent: once progress.email is "sent" the job never sends again, and an
invitation that is revoked, accepted or expired is a recorded no-op. A retry after a failed send mints a new token,
which replaces the undelivered one. Sending errors retry from the queue with backoff (docs/18)."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol

from .. import email_templates, mail
from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv

log = get_logger(__name__)

TOKEN_BYTES = 32   # docs/09


class NotifyStore(Protocol):
    def job_progress(self, job_id: str) -> dict[str, Any]: ...
    def invitation_for_email(self, invitation_id: str) -> dict[str, Any] | None: ...
    def set_invitation_token(self, invitation_id: str, token_hash: bytes) -> bool: ...


def new_token() -> tuple[str, bytes]:
    """32 random bytes, URL-safe; app.accept_invitation finds the invitation by sha256 of this text."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hashlib.sha256(token.encode()).digest()


def payload_uuid(value: Any, name: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise PermanentJobError(f"payload {name} is not a uuid") from None


def _done(ctx: JobContext, outcome: str) -> None:
    ctx.heartbeat(outcome=outcome)
    log.info("notify finished", extra=kv(outcome=outcome))


def send_invitation(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    invitation_id = payload_uuid(job.payload.get("invitation_id"), "invitation_id")
    if store.job_progress(job.id).get("email") == "sent":
        return _done(ctx, "already_sent")
    inv = store.invitation_for_email(invitation_id)
    if inv is None:
        raise PermanentJobError(f"invitation {invitation_id} does not exist")
    if job.workspace_id and inv["workspace_id"] != job.workspace_id:
        raise PermanentJobError(f"invitation {invitation_id} belongs to another workspace")
    if inv["revoked_at"] is not None:
        return _done(ctx, "skipped_revoked")
    if inv["accepted_at"] is not None:
        return _done(ctx, "skipped_accepted")
    if inv["expires_at"] <= datetime.now(UTC):
        return _done(ctx, "skipped_expired")

    mailer = mailer or mail.mailer_for(ctx.settings)
    base_url = ctx.settings.require_app_base_url()
    token, token_hash = new_token()
    if not store.set_invitation_token(invitation_id, token_hash):
        return _done(ctx, "skipped_not_pending")   # revoked, accepted or expired since it was read
    email = email_templates.invitation(to=inv["email"], inviter=inv["inviter_name"], workspace=inv["workspace_name"],
                                       role=inv["role"], expires_at=inv["expires_at"],
                                       url=f"{base_url}/invite/{token}")
    message_id = mail.send(mailer, email)
    ctx.heartbeat(email="sent", outcome="sent", **({"message_id": message_id} if message_id else {}))
    log.info("invitation email sent", extra=kv(invitation_id=invitation_id))


TEMPLATES = {"invitation": send_invitation}


@handler("notify")
def notify(job: Job, ctx: JobContext) -> None:
    template = job.payload.get("template")
    if template not in TEMPLATES:
        raise PermanentJobError(f"unknown notify template {str(template)[:40]!r}")
    TEMPLATES[template](job, ctx, ctx.store)  # type: ignore[arg-type]  # PgStore implements NotifyStore
