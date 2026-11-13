"""What a check reads and writes in Postgres (docs/05 §Evaluating one check, steps 1 and 7).

Reads the pinned ruleset's members, the node's coverage and gaps, the latest finished extraction of the artwork
version, the confirmed classification and the accepted term register. Writes every app.checks row of the job with
all its findings in one transaction, then app.product_nodes and one audit event, so a retry either finds the job's
checks already written or writes them all. private.verdict_guard refuses clear where coverage is incomplete (P0021),
which rolls the whole job back."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from psycopg.types.json import Jsonb

from ..errors import PermanentJobError, SafeError
from ..fixtures_runner import accepted_terms
from .core import CheckResult, Coverage, Node, Panel, Rule, TextLine, worst


class NoReleasedRuleset(PermanentJobError):
    """P0003: the job names a ruleset that was never released."""


class ExtractionPending(SafeError):
    """The artwork version has no finished extraction yet: the job retries, then fails visibly."""


@dataclass
class NodeInputs:
    node: Node
    rules: list[Rule]
    coverage: list[Coverage]


@dataclass(frozen=True)
class CheckRow:
    """One app.checks row to write: the evaluated result and the artwork and classification it was judged on."""
    result: CheckResult
    artwork_version_id: str
    artwork_sha: str
    classification_id: str | None


@dataclass
class CheckInputs:
    workspace_id: str
    product_id: str
    artwork_version_id: str
    artwork_sha: str
    ruleset_version: str
    classification_id: str | None
    facts: dict[str, Any]
    panels: tuple[Panel, ...]
    nodes: list[NodeInputs]
    terms: dict[tuple[str, str], tuple[str, ...]]
    actor_id: str | None
    actor_is_external: bool


CLASSIFICATION_FIELDS = ("species", "life_stage", "product_class", "intended_use", "parnut_status")


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


class PgCheckStore:
    def __init__(self, conn: Any):
        self.conn = conn

    def _one(self, sql: str, *args: Any) -> dict[str, Any] | None:
        return self.conn.execute(sql, args).fetchone()

    def load(self, job_id: str, workspace_id: str | None, product_id: str, artwork_version_id: str,
             ruleset_version: str, classification_id: str | None, node_ids: list[str],
             formula_digest: str | None = None) -> CheckInputs:
        if self._one("select 1 from ref.ruleset_versions where id = %s", ruleset_version) is None:
            raise NoReleasedRuleset(f"P0003: ruleset {ruleset_version} has not been released")
        product = self._one("select workspace_id, format from app.products where id = %s", product_id)
        if product is None or (workspace_id and str(product["workspace_id"]) != workspace_id):
            raise PermanentJobError(f"product {product_id} is not in the job's workspace")
        ws = str(product["workspace_id"])
        av = self._one("select file_sha256 from app.artwork_versions where id = %s and product_id = %s",
                       artwork_version_id, product_id)
        if av is None:
            raise PermanentJobError(f"artwork version {artwork_version_id} is not the product's")
        run = self._one("""select id, status from app.extraction_runs where artwork_version_id = %s
                            order by created_at desc, id desc limit 1""", artwork_version_id)
        if run is None or run["status"] in ("queued", "running"):
            raise ExtractionPending(f"artwork version {artwork_version_id} has no finished extraction")
        panels = self._panels(str(run["id"]))
        if not panels:
            raise PermanentJobError(f"extraction run {run['id']} has no panels")

        facts = self.facts(product_id, classification_id, formula_digest, product["format"])

        nodes = [self._node(product_id, ruleset_version, n) for n in node_ids]
        terms = {k: tuple(v) for k, v in accepted_terms(self.conn, ruleset_version).items()}
        actor = self._one("""select j.requested_by, coalesce(m.is_external, false) as is_external
                               from app.jobs j left join app.memberships m
                                 on m.workspace_id = j.workspace_id and m.person_id = j.requested_by
                                and m.ended_at is null
                              where j.id = %s""", job_id) or {}
        return CheckInputs(ws, product_id, artwork_version_id, av["file_sha256"], ruleset_version,
                           classification_id, facts, panels, nodes, terms,
                           str(actor["requested_by"]) if actor.get("requested_by") else None,
                           bool(actor.get("is_external")))

    def facts(self, product_id: str, classification_id: str | None, formula_digest: str | None = None,
              product_format: Any = None) -> dict[str, Any]:
        """The product facts rules read: the confirmed classification, the format and the formula's additives."""
        if product_format is None:
            row = self._one("select format from app.products where id = %s", product_id)
            product_format = row["format"] if row else None
        facts: dict[str, Any] = {f: None for f in CLASSIFICATION_FIELDS}
        if classification_id:
            c = self._one(f"""select {', '.join(CLASSIFICATION_FIELDS)} from app.classifications
                              where id = %s and product_id = %s and confirmed_at is not null""",
                          classification_id, product_id)
            if c:                     # an unconfirmed classification is missing data, never a guess (#45)
                facts.update(c)
        facts["format"] = product_format
        facts["additives"] = self._additives(product_id, formula_digest)
        # No stored source gives the product's quantity (character_height bands) or declared quantities
        # (threshold) yet (#52): both stay missing, so those rules are withheld data_missing, never guessed.
        facts["quantity"] = None
        facts["quantities"] = {}
        return facts

    def _panels(self, run_id: str) -> tuple[Panel, ...]:
        rows = self.conn.execute(
            """select id, panel_index, language, status, failure_code from app.artwork_panels
                where extraction_run_id = %s order by page, panel_index, id""", (run_id,)).fetchall()
        lines: dict[str, list[TextLine]] = {}
        for t in self.conn.execute(
                """select t.id, t.panel_id, t.text, t.bbox_mm, t.x_height_mm, t.cap_height_mm, t.is_ocr
                     from app.text_objects t
                     join app.artwork_panels p on p.id = t.panel_id
                    where p.extraction_run_id = %s order by t.reading_order nulls last, t.id""",
                (run_id,)).fetchall():
            lines.setdefault(str(t["panel_id"]), []).append(
                TextLine(t["text"], str(t["id"]), [float(x) for x in t["bbox_mm"]], _num(t["x_height_mm"]),
                         _num(t["cap_height_mm"]), bool(t["is_ocr"])))
        return tuple(Panel(r["panel_index"], r["language"] if r["language"] not in (None, "", "und") else None,
                           r["status"], r["failure_code"], tuple(lines.get(str(r["id"]), ())), str(r["id"]))
                     for r in rows)

    def _additives(self, product_id: str, pinned: str | None = None) -> list[dict[str, Any]] | None:
        """The formula's additive lines with their register row (additive_condition). None when the product has no
        formula lines at all: a formula never entered is missing data (withheld data_missing), not a formula without
        additives, which is the only case an additive rule is not_applicable (#172). None too when any line is not
        matched to the register (neither a feed material nor an additive): that line may be an additive, so the
        formula cannot be read as additive-free and additive rules are withheld, never passed (#76, Q1).

        `pinned` is the formula digest app.request_check put in the job (its key holds it too). The lines and their
        digest are read in one statement, so one snapshot: when the formula changed after the job was requested, the
        job is not judged on a formula other than its own, and the facts are missing (withheld) instead (#76 review).
        A payload without a digest (requested before T-1001) reads the formula as it is."""
        rows = self.conn.execute(
            """select f.feed_material_ref, f.additive_ref, f.amount, f.unit, a.id, a.species, a.max_content, a.expiry,
                      private.formula_digest(f.product_id) as digest
                 from app.formula_lines f left join ref.feed_additives a on a.id = f.additive_ref
                where f.product_id = %s
                order by f.position, f.id""", (product_id,)).fetchall()
        if pinned is not None and (rows[0]["digest"] if rows else "-") != pinned:
            return None
        if not rows or any(r["feed_material_ref"] is None and r["additive_ref"] is None for r in rows):
            return None
        return [{"additive_ref": r["additive_ref"], "amount": _num(r["amount"]), "unit": r["unit"],
                 "register": {"species": list(r["species"]) if r["species"] is not None else None,
                              "max_content": r["max_content"], "expiry": r["expiry"]} if r["id"] else None}
                for r in rows if r["additive_ref"] is not None]

    def _node(self, product_id: str, ruleset_version: str, node_id: str) -> NodeInputs:
        j = self._one("""select j.id, j.node_type, j.parent_id, j.languages from ref.jurisdictions j
                          join app.product_nodes pn on pn.node_id = j.id and pn.product_id = %s
                         where j.id = %s""", product_id, node_id)
        if j is None:
            raise PermanentJobError(f"node {node_id} is not a market of product {product_id}")
        region = j["id"] if j["node_type"] == "region" else j["parent_id"]
        node = Node(j["id"], tuple(j["languages"] or ()), region)
        rules = [Rule(r["rule_key"], r["version"], r["shape"], r["domain"], r["node_id"], r["title"],
                      r["params"] or {}, r["applicability"] or {"all": []}, r["article_ref"])
                 for r in self.conn.execute(
                     """select m.rule_key, m.version, r.shape, r.domain, r.node_id, r.title, rv.params,
                               rv.applicability, rv.article_ref
                          from ref.ruleset_members m
                          join ref.rules r on r.rule_key = m.rule_key
                          join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
                         where m.ruleset_version = %s and r.node_id = any(%s)
                         order by m.rule_key""",
                     (ruleset_version, [x for x in (node.id, region) if x])).fetchall()]
        coverage = [Coverage(c["domain"], c["state"], c["gap_id"], c["reason_code"])
                    for c in self.conn.execute(
                        """select c.domain, c.state, c.gap_id, g.reason_code from ref.coverage_nodes c
                             left join ref.coverage_gaps g on g.gap_id = c.gap_id
                            where c.ruleset_version = %s and c.node_id = %s order by c.domain""",
                        (ruleset_version, node.id)).fetchall()]
        return NodeInputs(node, rules, coverage)

    def write(self, job_id: str, inputs: CheckInputs, results: list[CheckResult], trigger: str = "user") -> bool:
        """All checks and findings of the job, the product markets and the audit event, in one transaction.
        False when the job's checks were already written (a retry or a duplicate delivery): nothing is written."""
        rows = [CheckRow(r, inputs.artwork_version_id, inputs.artwork_sha, inputs.classification_id) for r in results]
        return self.write_rows(job_id, inputs.workspace_id, inputs.product_id, inputs.ruleset_version, rows,
                               inputs.actor_id, inputs.actor_is_external, trigger)

    def write_rows(self, job_id: str, workspace_id: str, product_id: str, ruleset_version: str,
                   rows: list[CheckRow], actor_id: str | None, actor_is_external: bool, trigger: str, *,
                   bases: dict[str, str] | None = None, moved: dict[str, str] | None = None,
                   audit_extra: dict[str, Any] | None = None) -> bool:
        """write() for checks that may pin different artwork versions per market (the scoped re-check, T-903).

        Every writer locks the product markets it writes first, so two checks of one product × market never
        interleave. `bases` maps a market to the check that was its latest when this job was planned: under the lock,
        a market whose latest check is now another one (a newer check landed meanwhile) is not written and is put in
        `moved`, so a re-check never overwrites newer work. `audit_extra` goes into the check.completed event."""
        with self.conn.transaction():
            self.conn.execute("select 1 from app.jobs where id = %s for update", (job_id,))
            if self._one("select 1 from app.checks where job_id = %s limit 1", job_id):
                return False
            nodes = sorted({r.result.node_id for r in rows})
            self.conn.execute("""select 1 from app.product_nodes where product_id = %s and node_id = any(%s)
                                  order by node_id for update""", (product_id, nodes))
            if bases:
                gone: dict[str, str] = {}
                for node_id, expected in bases.items():
                    latest = self._one("""select id from app.checks where product_id = %s and node_id = %s
                                           order by at desc, id limit 1""", product_id, node_id)
                    if latest is None or str(latest["id"]) != expected:
                        gone[node_id] = str(latest["id"]) if latest else ""
                if moved is not None:
                    moved.update(gone)
                rows = [r for r in rows if r.result.node_id not in gone]
                if not rows:
                    return False
            ids = []
            for row in rows:
                r = row.result
                check_id = self._one(
                    """insert into app.checks (workspace_id, job_id, product_id, node_id, artwork_version_id,
                           panel_id, language, artwork_sha, ruleset_version, classification_id, label_state,
                           applied_rule_keys, passed_rule_keys, withheld_rule_keys, actor_id, actor_is_external,
                           trigger)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                    workspace_id, job_id, product_id, r.node_id, row.artwork_version_id,
                    r.panel.id, r.panel.language, row.artwork_sha, ruleset_version,
                    row.classification_id, r.label_state, r.applied, r.passed, r.withheld, actor_id,
                    actor_is_external, trigger)["id"]
                ids.append(str(check_id))
                for f in r.findings:
                    self.conn.execute(
                        """insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key,
                               rule_version, gap_id, state, provenance, citation, message, panel_id, language,
                               text_object_id, bbox_mm, reason_code, confidence, model_call_id, measured_mm,
                               required_mm, height_definition, kind, recommended_action)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                   %s, %s, %s)""",
                        (workspace_id, check_id, product_id, r.node_id, f.get("rule_key"),
                         f.get("rule_version"), f.get("gap_id"), f["state"], f["provenance"], f.get("citation"),
                         f["message"], f.get("panel_id"), f.get("language"), f.get("text_object_id"),
                         f.get("bbox_mm"), f.get("reason_code"), f.get("confidence"), f.get("model_call_id"),
                         f.get("measured_mm"), f.get("required_mm"), f.get("height_definition"),
                         f.get("kind", "label"), f.get("recommended_action")))
            states: dict[str, dict[str, Any]] = {}
            for row in rows:
                s = states.setdefault(row.result.node_id, {"states": [], "open": 0})
                s["states"].append(row.result.label_state)
                s["open"] += row.result.open_actions
            for node_id, s in states.items():
                self.conn.execute(
                    """update app.product_nodes set label_state = %s, ruleset_version = %s, open_actions = %s,
                              last_check_job_id = %s, updated_at = now()
                        where product_id = %s and node_id = %s""",
                    (worst(s["states"]), ruleset_version, s["open"], job_id, product_id, node_id))
                # D06: registration state is derived in the database, separately from the label (non-negotiable 8)
                self.conn.execute("select private.refresh_registration_state(%s, %s)", (product_id, node_id))
            self.conn.execute(
                "select private.write_audit(%s, 'check.completed', 'job', %s, null, %s, %s)",
                (workspace_id, job_id,
                 Jsonb({"check_ids": ids, "label_states": {n: worst(s["states"]) for n, s in states.items()},
                        "trigger": trigger, **{k: v for k, v in (audit_extra or {}).items()
                                               if k not in ("check_ids", "label_states", "trigger")}}),
                 ruleset_version))
        return True
