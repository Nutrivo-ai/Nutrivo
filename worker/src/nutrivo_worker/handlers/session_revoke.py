"""session_revoke (A06): sign a removed member out. Payload {"membership_id", "person_id"}: ids only.

Deletes the person's auth.sessions created before the membership ended (refresh tokens go with them), so access
tokens already issued simply expire; access itself ended at removal, because every RLS helper requires an active
membership. Idempotent: a re-run finds nothing older to delete and never signs out a session started afterwards.
A membership that is still active, or a person without a user (erased), is a recorded no-op."""
from __future__ import annotations

from typing import Any, Protocol

from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from .notify import payload_uuid

log = get_logger(__name__)


class SessionStore(Protocol):
    def membership_for_revoke(self, membership_id: str) -> dict[str, Any] | None: ...
    def revoke_sessions(self, user_id: str, created_before: Any) -> int: ...


def revoke(job: Job, ctx: JobContext, store: SessionStore) -> None:
    membership_id = payload_uuid(job.payload.get("membership_id"), "membership_id")
    m = store.membership_for_revoke(membership_id)
    if m is None:
        raise PermanentJobError(f"membership {membership_id} does not exist")
    if job.workspace_id and m["workspace_id"] != job.workspace_id:
        raise PermanentJobError(f"membership {membership_id} belongs to another workspace")
    if m["ended_at"] is None:
        outcome, revoked = "skipped_active", 0
    elif m["user_id"] is None:
        outcome, revoked = "skipped_no_user", 0
    else:
        outcome, revoked = "revoked", store.revoke_sessions(m["user_id"], m["ended_at"])
    ctx.heartbeat(outcome=outcome, sessions_revoked=revoked)
    log.info("session_revoke finished", extra=kv(membership_id=membership_id, outcome=outcome, revoked=revoked))


@handler("session_revoke")
def session_revoke(job: Job, ctx: JobContext) -> None:
    revoke(job, ctx, ctx.store)  # type: ignore[arg-type]  # PgStore implements SessionStore
