"""recheck (T-903, J05): the scoped re-check of one recipe after a material rule diff (BE-25, BE-42).

Payload from app.request_scoped_recheck, ids only: {"product_id", "node_ids", "rule_diff_id"}; key
recheck:<diff>:<product>, one job per recipe, staff-triggered. The target ruleset is the diff's.

Per market the base is the latest check (its job's checks, one per language panel), the same row contract 5 read to
name the recipe. Only the changed rules are evaluated, on the base's panels: a rule held on the market or its region
whose ruleset member (rule_key, version) differs between the base's ruleset and the target, or whose linked term
register entries differ. Every other rule's outcome and findings are carried forward unchanged (same rule_version,
same artwork, same classification, same formula), which is exactly what evaluating it again would give. A rule no longer
in the target is dropped. Coverage findings are recomputed from the target's coverage and the label state is
recomputed (core.label_state), so private.verdict_guard still refuses clear on incomplete coverage: no rule, no
verdict. The re-evaluated rules read the formula pinned by the base job's formula digest; a formula changed since
gives missing data (withheld), never a guess.

A market with no base check, a base check without a panel, or one already on the target ruleset or a later one is
skipped and named in the progress. All checks of the job are written in one transaction with trigger 'rule_diff' and
one 'check.completed' audit event: one event per recipe (BE-42). Idempotent: a retry finds the job's checks and
writes nothing. Model calls go through nutrivo_worker.models only, inside the job's Langfuse trace."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sentry_sdk

from .. import models
from ..engine.core import CheckResult, Coverage, Node, Panel, Rule, coverage_incomplete, evaluate_check, label_state
from ..engine.store import CheckRow, PgCheckStore
from ..errors import PermanentJobError
from ..fixtures_runner import accepted_terms
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv
from .notify import payload_uuid

log = get_logger(__name__)

UNRESOLVED_FORMULA = "unresolved"     # matches no formula digest: additive facts are missing, never the live formula

FINDING_FIELDS = ("rule_key", "rule_version", "gap_id", "state", "provenance", "citation", "message", "panel_id",
                  "language", "text_object_id", "bbox_mm", "reason_code", "confidence", "model_call_id",
                  "measured_mm", "required_mm", "height_definition", "kind", "recommended_action")


@dataclass
class BaseCheck:
    """One check of the base: a market × language panel as last judged."""
    id: str
    panel: Panel
    applied: list[str]
    passed: list[str]
    withheld: list[str]
    findings: list[dict[str, Any]]


@dataclass
class MarketPlan:
    node: Node
    base_ruleset: str
    artwork_version_id: str
    artwork_sha: str
    classification_id: str | None
    facts: dict[str, Any]
    panels: tuple[Panel, ...]
    checks: list[BaseCheck]
    changed: list[Rule]                  # evaluated
    unchanged: set[str]                  # carried forward
    coverage: list[Coverage] = field(default_factory=list)
    base_latest_id: str = ""             # the latest check when planned; re-verified under the write's lock
    formula_digest: str | None = None    # what the re-evaluated rules read (recorded for the next re-check)


def term_keys(params: Any) -> set[str]:
    """Every term register key a rule's params link (term_key, alternative_term_keys, detect.term_keys, ...)."""
    out: set[str] = set()
    if isinstance(params, dict):
        for k, v in params.items():
            if k.endswith("term_key") and isinstance(v, str):
                out.add(v)
            elif k.endswith("term_keys") and isinstance(v, list):
                out.update(x for x in v if isinstance(x, str))
            else:
                out |= term_keys(v)
    elif isinstance(params, list):
        for v in params:
            out |= term_keys(v)
    return out


def split_rules(target: list[Rule], base_members: dict[str, int], target_terms: dict[tuple[str, str], Any],
                base_terms: dict[tuple[str, str], Any]) -> tuple[list[Rule], set[str]]:
    """(rules to evaluate, rule keys to carry forward). A rule is unchanged only when the base ruleset held the same
    version and every register entry it links is the same in both rulesets."""
    changed: list[Rule] = []
    unchanged: set[str] = set()
    for rule in target:
        if base_members.get(rule.rule_key) != rule.version:
            changed.append(rule)
            continue
        keys = term_keys(rule.params)
        if any(sorted(target_terms.get(k, ())) != sorted(base_terms.get(k, ()))
               for k in {tk for tk in target_terms if tk[0] in keys} | {tk for tk in base_terms if tk[0] in keys}):
            changed.append(rule)
            continue
        unchanged.add(rule.rule_key)
    return changed, unchanged


def merge(fresh: CheckResult, base: BaseCheck, unchanged: set[str], coverage: list[Coverage]) -> CheckResult:
    """The re-checked panel: fresh coverage and changed-rule results, plus the base's outcomes for unchanged rules."""
    carried = [f for f in base.findings if f.get("rule_key") in unchanged]
    out = CheckResult(fresh.node_id, fresh.panel, "not_assessed",
                      applied=sorted(set(fresh.applied) | {k for k in base.applied if k in unchanged}),
                      passed=sorted(set(fresh.passed) | {k for k in base.passed if k in unchanged}),
                      withheld=sorted(set(fresh.withheld) | {k for k in base.withheld if k in unchanged}),
                      findings=fresh.findings + carried)
    failed = any(f["state"] == "action" for f in out.findings)
    out.label_state = label_state(failed, bool(out.withheld), coverage_incomplete(coverage), bool(out.applied))
    return out


class PgRecheckStore(PgCheckStore):
    def diff(self, rule_diff_id: str) -> dict[str, Any] | None:
        return self._one("""select d.rule_key, d.effect_type, d.ruleset_version, rv.released_at
                              from ref.rule_diffs d join ref.ruleset_versions rv on rv.id = d.ruleset_version
                             where d.id = %s""", rule_diff_id)

    def members(self, ruleset: str) -> dict[str, int]:
        return {r["rule_key"]: r["version"] for r in self.conn.execute(
            "select rule_key, version from ref.ruleset_members where ruleset_version = %s", (ruleset,)).fetchall()}

    def terms(self, ruleset: str) -> dict[tuple[str, str], tuple[str, ...]]:
        return {k: tuple(v) for k, v in accepted_terms(self.conn, ruleset).items()}

    def latest_check(self, product_id: str, node_id: str) -> dict[str, Any] | None:
        return self._one("""select id, job_id from app.checks where product_id = %s and node_id = %s
                             order by at desc, id limit 1""", product_id, node_id)

    def base(self, product_id: str, node_id: str) -> list[dict[str, Any]]:
        """The latest check of the product × market and the checks of the same job (contract 5's 'latest')."""
        latest = self.latest_check(product_id, node_id)
        if latest is None:
            return []
        rows = self.conn.execute(
            """select c.*, rv.released_at, (c.id = %s) as is_latest
                 from app.checks c join ref.ruleset_versions rv on rv.id = c.ruleset_version
                where c.product_id = %s and c.node_id = %s
                  and (c.id = %s or (%s::uuid is not null and c.job_id = %s))
                order by c.language nulls last, c.id""",
            (latest["id"], product_id, node_id, latest["id"], latest["job_id"], latest["job_id"])).fetchall()
        return rows

    def findings(self, check_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(f"select {', '.join(FINDING_FIELDS)} from app.check_findings where check_id = %s "
                                 "order by created_at, id", (check_id,)).fetchall()
        return [{k: (str(v) if k in ("panel_id", "text_object_id", "model_call_id") and v is not None else v)
                 for k, v in r.items()} for r in rows]

    def formula_digest(self, job_id: Any, node_id: str) -> str | None:
        """The formula digest the base check of `node_id` was judged on, so a chain of re-checks stays on one formula.
        A check job pins it in its payload (None there: a job from before T-1001, which read the formula as it was).
        A recheck job records the digest it used per market in its own check.completed audit event, written in the
        same transaction as its checks. Anything else (a check without a job, a recheck with no record) is
        UNRESOLVED_FORMULA: it matches no formula, so additive facts are missing and those rules are withheld."""
        job = self._one("select kind, payload from app.jobs where id = %s", job_id) if job_id else None
        if job is None:
            return UNRESOLVED_FORMULA
        if job["kind"] == "check":
            d = (job["payload"] or {}).get("formula_digest")
            return d if isinstance(d, str) and d else None
        if job["kind"] == "recheck":
            ev = self._one("""select after from app.audit_events where kind = 'check.completed' and object_type = 'job'
                               and object_id = %s order by at desc limit 1""", str(job_id))
            digests = (ev or {}).get("after", {}) or {}
            digests = digests.get("formula_digests") if isinstance(digests, dict) else None
            if isinstance(digests, dict) and node_id in digests:
                d = digests[node_id]
                return d if isinstance(d, str) and d else None
        return UNRESOLVED_FORMULA

    def panels_of(self, panel_id: str) -> tuple[Panel, ...]:
        run = self._one("select extraction_run_id from app.artwork_panels where id = %s", panel_id)
        return self._panels(str(run["extraction_run_id"])) if run else ()


def plan_market(store: PgRecheckStore, product_id: str, node_id: str, diff: dict[str, Any],
                target_members: dict[str, int], target_terms: dict[tuple[str, str], Any]) -> MarketPlan | str:
    """The market's re-check plan, or the reason it is skipped."""
    rows = store.base(product_id, node_id)
    if not rows:
        return "no_base_check"
    if any(r["released_at"] >= diff["released_at"] for r in rows):
        return "already_current"
    if any(r["panel_id"] is None or r["artwork_version_id"] is None for r in rows):
        return "base_without_panel"
    if len({(str(r["artwork_version_id"]), r["ruleset_version"], r["classification_id"]) for r in rows}) != 1:
        return "base_inconsistent"
    first = rows[0]
    base_ruleset = first["ruleset_version"]
    product_id_s = str(product_id)
    nodes = store._node(product_id_s, diff["ruleset_version"], node_id)
    panels = store.panels_of(str(first["panel_id"]))
    by_id = {p.id: p for p in panels}
    checks = []
    for r in rows:
        panel = by_id.get(str(r["panel_id"]))
        if panel is None:
            return "base_without_panel"
        checks.append(BaseCheck(str(r["id"]), panel, list(r["applied_rule_keys"]), list(r["passed_rule_keys"]),
                                list(r["withheld_rule_keys"]), store.findings(str(r["id"]))))
    base_members = store.members(base_ruleset)
    changed, unchanged = split_rules(nodes.rules, base_members, target_terms, store.terms(base_ruleset))
    digest = store.formula_digest(first["job_id"], node_id)
    classification_id = str(first["classification_id"]) if first["classification_id"] else None
    facts = store.facts(product_id_s, classification_id, digest)
    av = store._one("select file_sha256 from app.artwork_versions where id = %s", first["artwork_version_id"])
    return MarketPlan(nodes.node, base_ruleset, str(first["artwork_version_id"]),
                      first["artwork_sha"] or (av or {}).get("file_sha256") or "", classification_id, facts, panels,
                      checks, changed, unchanged, nodes.coverage,
                      next(str(r["id"]) for r in rows if r["is_latest"]), digest)


def run_recheck(job: Job, ctx: JobContext, store: PgRecheckStore, model_client: Any = models,
                claim_thresholds: Any = None) -> dict[str, Any]:
    p = job.payload
    if not job.workspace_id:
        raise PermanentJobError("a recheck job names its workspace")
    product_id = payload_uuid(p.get("product_id"), "product_id")
    diff_id = payload_uuid(p.get("rule_diff_id"), "rule_diff_id")
    node_ids = p.get("node_ids")
    if not isinstance(node_ids, list) or not node_ids or not all(isinstance(n, str) and n for n in node_ids):
        raise PermanentJobError("payload node_ids is not a non-empty list of node ids")
    diff = store.diff(diff_id)
    if diff is None:
        raise PermanentJobError(f"rule diff {diff_id} does not exist")
    if diff["effect_type"] == "editorial":
        raise PermanentJobError("an editorial diff is never re-checked (BE-09)")
    product = store._one("select workspace_id from app.products where id = %s", product_id)
    if product is None or str(product["workspace_id"]) != job.workspace_id:
        raise PermanentJobError(f"product {product_id} is not in the job's workspace")

    ruleset = diff["ruleset_version"]
    if store._one("select 1 from app.checks where job_id = %s limit 1", job.id):
        # A retry or a duplicate delivery: the job's checks are its base now, so nothing is planned or written.
        progress = {"outcome": "already_rechecked", "rule_diff_id": diff_id, "ruleset_version": ruleset}
        ctx.heartbeat(**progress)
        return progress
    target_members = store.members(ruleset)
    target_terms = store.terms(ruleset)
    rows: list[CheckRow] = []
    bases: dict[str, str] = {}
    digests: dict[str, str | None] = {}
    skipped: dict[str, str] = {}
    evaluated: set[str] = set()
    judgements: dict[Any, Any] = {}
    for node_id in sorted(set(node_ids)):
        plan = plan_market(store, product_id, node_id, diff, target_members, target_terms)
        if isinstance(plan, str):
            skipped[node_id] = plan
            continue
        evaluated.update(r.rule_key for r in plan.changed)
        bases[node_id] = plan.base_latest_id
        digests[node_id] = plan.formula_digest
        with sentry_sdk.start_span(op="recheck.node", name=node_id):
            for base in plan.checks:
                fresh = evaluate_check(plan.node, base.panel, plan.panels, plan.changed, plan.coverage, target_terms,
                                       plan.facts, models=model_client, workspace_id=job.workspace_id,
                                       model_store=ctx.store, claim_thresholds=claim_thresholds,
                                       judgement_cache=judgements)
                rows.append(CheckRow(merge(fresh, base, plan.unchanged, plan.coverage), plan.artwork_version_id,
                                     plan.artwork_sha, plan.classification_id))
                ctx.heartbeat(checks=len(rows))
    actor = store._one("select requested_by from app.jobs where id = %s", job.id) or {}
    moved: dict[str, str] = {}
    written = store.write_rows(job.id, job.workspace_id, product_id, ruleset, rows,
                               str(actor["requested_by"]) if actor.get("requested_by") else None, False,
                               "rule_diff", bases=bases, moved=moved,
                               audit_extra={"formula_digests": digests}) if rows else False
    for node_id in moved:              # a newer check landed while this one was judged: it is never overwritten
        skipped[node_id] = "superseded"
    rows = [r for r in rows if r.result.node_id not in moved]
    outcome = ("rechecked" if written and rows else "superseded" if moved and not rows
               else "already_rechecked" if written is False and rows else "nothing_to_recheck")
    progress = {"outcome": outcome, "rule_diff_id": diff_id, "ruleset_version": ruleset, "checks": len(rows),
                "evaluated_rule_keys": sorted(evaluated), "skipped": skipped}
    ctx.heartbeat(**progress)
    log.info("recheck finished", extra=kv(outcome=outcome, checks=len(rows), evaluated=len(evaluated),
                                          skipped=len(skipped), ruleset_version=ruleset))
    return progress


@handler("recheck")
def recheck(job: Job, ctx: JobContext) -> None:
    run_recheck(job, ctx, PgRecheckStore(ctx.store.conn))  # type: ignore[attr-defined]  # PgStore has a connection
