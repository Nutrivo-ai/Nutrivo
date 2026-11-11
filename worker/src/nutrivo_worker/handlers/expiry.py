"""expiry_reminders · payload {} (T-803, H04): the daily producer of Template 04's notices.

pg_cron queues one job a day at 06:23 UTC (private.enqueue_expiry_reminders, keyed by the UTC date). The job runs
inside the Sentry cron check-in 'expiry-reminders' (docs/17) and calls app.queue_expiry_reminders, which queues one
notify job per document and notice (60, 30 or 7 days; key doc:<id>:<days>, ids only), so a rerun, a retry or a
second job on the same day queues nothing new. A notice whose notify job failed is re-queued (the same job, its
progress kept) by the next run while it is still the notice due, so a failure never uses up its key. The notify
handler (T-602) sends the email and the in-app row. One transaction: either every notice due is queued or none is, and a failure retries
the whole job (bounded by max_attempts) while the check-in reports the error."""
from __future__ import annotations

from typing import Protocol

from .. import observability as obs
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv

log = get_logger(__name__)


class ExpiryStore(Protocol):
    def queue_expiry_reminders(self, ref: str) -> dict[str, int]: ...


def expiry_reminders(job: Job, ctx: JobContext, store: ExpiryStore) -> dict[str, int]:
    with obs.cron_checkin(obs.EXPIRY_REMINDERS_MONITOR, obs.EXPIRY_REMINDERS_CONFIG):
        counts = store.queue_expiry_reminders(job.id)
        counts = {k: int(counts.get(k, 0)) for k in ("queued", "requeued", "already")}
        ctx.heartbeat(**counts)
        log.info("expiry_reminders finished", extra=kv(**counts))
    return counts


@handler("expiry_reminders")
def expiry_reminders_job(job: Job, ctx: JobContext) -> None:
    expiry_reminders(job, ctx, ctx.store)  # type: ignore[arg-type]
