"""diff_fanout (T-901, J03): a released rule diff becomes alerts on the products that applied or withheld its rule.

Two payloads, ids and dates only (docs/04-contracts.md):
- {"rule_diff_id"}, key diff_fanout:<rule_diff_id>, queued by app.release_ruleset for each non-editorial diff (BE-09).
  app.fan_out_rule_diff writes one alert per row of contract 5 (app.affected_objects: the latest check's applied and
  withheld rule keys, never a re-evaluation; BE-24), 'coming' before the diff's effective date and 'in_force' from it.
  Then app.supersede_for_rule_diff marks superseded every report (and its certificates) whose checks applied or
  withheld the rule under an earlier ruleset (T-903, I05, BE-30): never for an editorial diff, never 'invalid'.
- {"sweep": "YYYY-MM-DD"}, key diff_fanout:sweep:<day>, queued by pg_cron once a day (07:23 UTC) and run inside the
  Sentry cron check-in 'alert-sweep' (docs/17). app.run_alert_sweep writes the 'in_force' row of each 'coming' alert
  whose date has arrived and queues one notify 'rule_changed' job per diff × workspace: Template 03, batched daily.

Idempotent: the database writes a diff × product × market's alert once, its in_force row once and each notify job
once (a unique index and app.jobs.idempotency_key), so a retry or a duplicate delivery changes nothing. Errors retry
with the runtime's bounded backoff and are reported to Sentry; a malformed payload or an unknown diff fails at once.
Logs carry ids and counts only."""
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any, Protocol

from .. import observability as obs
from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from .notify import payload_uuid

log = get_logger(__name__)

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class DiffFanoutStore(Protocol):
    def fan_out_rule_diff(self, rule_diff_id: str) -> dict[str, Any] | None: ...
    def run_alert_sweep(self, day: date) -> dict[str, Any]: ...
    def supersede_for_rule_diff(self, rule_diff_id: str) -> dict[str, Any] | None: ...


def _sweep_day(value: Any, today: date) -> date:
    if not isinstance(value, str) or not DAY.match(value):
        raise PermanentJobError("payload sweep is not a YYYY-MM-DD day")
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise PermanentJobError("payload sweep is not a YYYY-MM-DD day") from None
    if day > today:
        raise PermanentJobError("payload sweep names a day not yet reached")
    return day


def run(job: Job, ctx: JobContext, store: DiffFanoutStore, today: date | None = None) -> dict[str, Any]:
    if job.workspace_id:
        raise PermanentJobError("a diff_fanout job names no workspace")
    has_diff, has_sweep = "rule_diff_id" in job.payload, "sweep" in job.payload
    if has_diff == has_sweep:
        raise PermanentJobError("payload needs exactly one of rule_diff_id and sweep")

    if has_diff:
        diff_id = payload_uuid(job.payload.get("rule_diff_id"), "rule_diff_id")
        result = store.fan_out_rule_diff(diff_id)
        if result is None:
            raise PermanentJobError(f"rule diff {diff_id} does not exist")
        editorial = result.get("skipped") == "editorial"
        progress = {"outcome": "skipped_editorial" if editorial else "fanned_out",
                    "rule_diff_id": diff_id, "alerts": int(result.get("alerts") or 0),
                    "workspaces": len(result.get("workspaces") or [])}
        if not editorial:             # I05.must.1: an editorial diff never supersedes
            superseded = store.supersede_for_rule_diff(diff_id) or {}
            progress |= {"superseded_reports": int(superseded.get("reports") or 0),
                         "superseded_certificates": int(superseded.get("certificates") or 0)}
        ctx.heartbeat(**progress)
        log.info("diff fan-out finished", extra=kv(**progress))
        return progress

    day = _sweep_day(job.payload.get("sweep"), today or datetime.now(UTC).date())
    with obs.cron_checkin(obs.ALERT_SWEEP_MONITOR, obs.ALERT_SWEEP_CONFIG):
        result = store.run_alert_sweep(day)
        progress = {"outcome": "swept", "day": day.isoformat(), "in_force": int(result.get("in_force") or 0),
                    "notify_jobs": int(result.get("notify_jobs") or 0)}
        ctx.heartbeat(**progress)
        log.info("alert sweep finished", extra=kv(**progress))
    return progress


@handler("diff_fanout")
def diff_fanout(job: Job, ctx: JobContext) -> None:
    run(job, ctx, ctx.store)  # type: ignore[arg-type]  # PgStore implements DiffFanoutStore
