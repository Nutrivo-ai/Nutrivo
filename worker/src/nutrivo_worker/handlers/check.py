"""check (D04): run a check of a product's latest artwork in its markets. Payload from app.request_check, ids only:
{"product_id", "artwork_version_id", "ruleset_version", "classification_id", "node_ids"}.

Per market × language panel the engine evaluates the pinned ruleset (nutrivo_worker.engine); every app.checks row
and its findings are written in one transaction with the product markets (docs/05 step 7). Idempotent: a retry or a
duplicate finds the job's checks and writes nothing (`already_checked`). A ruleset that was never released fails the
job at once (P0003); an extraction still running retries through the runtime's bounded backoff, then fails visibly.
Model calls go through nutrivo_worker.models only, inside the job's Langfuse trace; a model error withholds its rules
(`model_unavailable`), never passes them."""
from __future__ import annotations

from typing import Any

import sentry_sdk

from .. import models
from ..engine import evaluate_check
from ..engine.core import CheckResult
from ..engine.store import PgCheckStore
from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from .notify import payload_uuid

log = get_logger(__name__)


def _node_ids(value: Any) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(v, str) and v for v in value):
        raise PermanentJobError("payload node_ids is not a non-empty list of node ids")
    return sorted(set(value))


def run_check(job: Job, ctx: JobContext, store: PgCheckStore, model_client: Any = models) -> list[CheckResult]:
    p = job.payload
    ruleset = p.get("ruleset_version")
    if not isinstance(ruleset, str) or not ruleset:
        raise PermanentJobError("P0003: payload names no released ruleset")
    product_id = payload_uuid(p.get("product_id"), "product_id")
    artwork_id = payload_uuid(p.get("artwork_version_id"), "artwork_version_id")
    classification_id = payload_uuid(p["classification_id"], "classification_id") \
        if p.get("classification_id") else None
    inputs = store.load(job.id, job.workspace_id, product_id, artwork_id, ruleset, classification_id,
                        _node_ids(p.get("node_ids")))
    results: list[CheckResult] = []
    for n in inputs.nodes:
        with sentry_sdk.start_span(op="check.node", name=n.node.id):
            for panel in inputs.panels:
                results.append(evaluate_check(n.node, panel, inputs.panels, n.rules, n.coverage, inputs.terms,
                                              inputs.facts, models=model_client, workspace_id=inputs.workspace_id,
                                              model_store=ctx.store))
    written = store.write(job.id, inputs, results)
    counts = {s: sum(1 for r in results if r.label_state == s) for s in ("clear", "action", "not_assessed")}
    outcome = "checked" if written else "already_checked"
    ctx.heartbeat(outcome=outcome, checks=len(results), **counts)
    log.info("check finished", extra=kv(outcome=outcome, checks=len(results), ruleset_version=ruleset, **counts))
    return results


@handler("check")
def check(job: Job, ctx: JobContext) -> None:
    run_check(job, ctx, PgCheckStore(ctx.store.conn))  # type: ignore[attr-defined]  # PgStore has a connection
