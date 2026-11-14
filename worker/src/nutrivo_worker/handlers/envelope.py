"""envelope (E02): compute a brief's compliance envelope. Payload from app.request_envelope, ids and digests only:
{"product_id", "ruleset_version", "inputs_hash", "node_ids", "formula_digest"}.

Per market the engine (engine.envelope) reads the pinned ruleset's accepted members and coverage; the envelope, its
items and its markets are written in one transaction (engine.envelope_store). Idempotent: a retry, a duplicate or a
second job for the same inputs writes nothing (`already_computed`); a job whose inputs changed after it was
requested writes nothing (`superseded`), because the newer request has its own job. No model is called."""
from __future__ import annotations

from typing import Any

import sentry_sdk

from ..engine.envelope import NodeEnvelope, build_node
from ..engine.envelope_store import PgEnvelopeStore
from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from .notify import payload_uuid

log = get_logger(__name__)


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise PermanentJobError(f"payload {name} is missing")
    return value


def run_envelope(job: Job, ctx: JobContext, store: PgEnvelopeStore) -> list[NodeEnvelope]:
    p = job.payload
    ruleset = p.get("ruleset_version")
    if not isinstance(ruleset, str) or not ruleset:
        raise PermanentJobError("P0003: payload names no released ruleset")
    product_id = payload_uuid(p.get("product_id"), "product_id")
    inputs_hash = _text(p.get("inputs_hash"), "inputs_hash")
    nodes = p.get("node_ids")
    if not isinstance(nodes, list) or not nodes or not all(isinstance(n, str) and n for n in nodes):
        raise PermanentJobError("payload node_ids is not a non-empty list of node ids")
    formula = p.get("formula_digest")
    if formula is not None and (not isinstance(formula, str) or not formula):
        raise PermanentJobError("payload formula_digest is not a digest")
    inputs = store.load(job.workspace_id, product_id, ruleset, inputs_hash, list(nodes), formula)
    if inputs is None:
        ctx.heartbeat(outcome="superseded")
        log.info("envelope superseded", extra=kv(outcome="superseded", ruleset_version=ruleset))
        return []
    results: list[NodeEnvelope] = []
    for n in inputs.nodes:
        with sentry_sdk.start_span(op="envelope.node", name=n.node.id):
            results.append(build_node(n.node, n.rules, n.coverage, inputs.terms, inputs.facts))
    outcome = store.write(job.id, inputs, results)
    counts = {s: sum(1 for r in results if r.state == s) for s in ("clear", "action", "not_assessed")}
    ctx.heartbeat(outcome=outcome, markets=len(results), withheld=sum(r.withheld for r in results), **counts)
    log.info("envelope finished", extra=kv(outcome=outcome, markets=len(results), ruleset_version=ruleset, **counts))
    return results


@handler("envelope")
def envelope(job: Job, ctx: JobContext) -> None:
    run_envelope(job, ctx, PgEnvelopeStore(ctx.store.conn))  # type: ignore[attr-defined]  # PgStore has a connection
