"""rate_purge · payload {} (T-1103): the daily purge of the RPC rate counters.

pg_cron queues one job a day at 02:53 UTC (private.enqueue_rate_purge, keyed by the UTC date). The job runs inside the
Sentry cron check-in 'rate-counter-purge' (docs/17) and calls app.purge_rate_counters, which deletes the counters of
windows older than two days (private.rate_counters). Idempotent: a rerun deletes nothing more. A failure reports the
check-in as an error and the job retries (bounded by max_attempts)."""
from __future__ import annotations

from typing import Protocol

from .. import observability as obs
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv

log = get_logger(__name__)


class PurgeStore(Protocol):
    def purge_rate_counters(self, ref: str) -> dict[str, int]: ...


def rate_purge(job: Job, ctx: JobContext, store: PurgeStore) -> dict[str, int]:
    with obs.cron_checkin(obs.RATE_PURGE_MONITOR, obs.RATE_PURGE_CONFIG):
        counts = {"deleted": int(store.purge_rate_counters(job.id).get("deleted", 0))}
        ctx.heartbeat(**counts)
        log.info("rate_purge finished", extra=kv(**counts))
    return counts


@handler("rate_purge")
def rate_purge_job(job: Job, ctx: JobContext) -> None:
    rate_purge(job, ctx, ctx.store)  # type: ignore[arg-type]
