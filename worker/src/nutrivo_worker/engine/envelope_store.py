"""What an envelope reads and writes in Postgres (E02).

Reads the pinned ruleset's members and the coverage of each market (as a check does, engine.store), the accepted
term register, the brief's facts and its formula's additive lines. Facts: the latest classification when a person
confirmed it, otherwise the species, life stage and format a person entered for the product (C01); anything else is
missing, so a rule that needs it is withheld `data_missing` (#77 default 1). Writes the envelope, its items and its
markets in one transaction, items before markets so private.envelope_verdict_guard sees them.

The job pins its inputs: `inputs_hash` is private.envelope_inputs_hash at request time. When the inputs changed
since (a newer request has its own job), the job writes nothing (`superseded`); one envelope per job and one per
(product, ruleset, inputs_hash), so a retry or a duplicate writes nothing either (`already_computed`)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from psycopg.types.json import Jsonb

from ..errors import PermanentJobError
from ..fixtures_runner import accepted_terms
from .envelope import OUT_OF_SCOPE, NodeEnvelope
from .store import CLASSIFICATION_FIELDS, NodeInputs, NoReleasedRuleset, PgCheckStore, _num


@dataclass
class EnvelopeInputs:
    workspace_id: str
    product_id: str
    ruleset_version: str
    inputs_hash: str
    formula_digest: str | None
    node_ids: list[str]
    facts: dict[str, Any]
    nodes: list[NodeInputs]
    terms: dict[tuple[str, str], tuple[str, ...]]


class PgEnvelopeStore:
    def __init__(self, conn: Any):
        self.conn = conn
        self._checks = PgCheckStore(conn)

    def _one(self, sql: str, *args: Any) -> dict[str, Any] | None:
        return self.conn.execute(sql, args).fetchone()

    def current_hash(self, product_id: str, node_ids: list[str]) -> str:
        return self._one("select private.envelope_inputs_hash(%s, %s) as h", product_id, node_ids)["h"]

    def load(self, workspace_id: str | None, product_id: str, ruleset_version: str, inputs_hash: str,
             node_ids: list[str], formula_digest: str | None) -> EnvelopeInputs | None:
        """None when the brief's inputs are no longer the ones the job was requested for."""
        if self._one("select 1 from ref.ruleset_versions where id = %s", ruleset_version) is None:
            raise NoReleasedRuleset(f"P0003: ruleset {ruleset_version} has not been released")
        product = self._one("select workspace_id, species, life_stage, format from app.products where id = %s",
                            product_id)
        if product is None or (workspace_id and str(product["workspace_id"]) != workspace_id):
            raise PermanentJobError(f"product {product_id} is not in the job's workspace")
        if self.current_hash(product_id, node_ids) != inputs_hash:
            return None
        facts: dict[str, Any] = {f: None for f in CLASSIFICATION_FIELDS}
        c = self._one(f"""select {', '.join(CLASSIFICATION_FIELDS)}, confirmed_at from app.classifications
                          where product_id = %s order by created_at desc, id desc limit 1""", product_id)
        if c and c["confirmed_at"] is not None:
            facts.update({f: c[f] for f in CLASSIFICATION_FIELDS})
        else:                       # a person's own entry at C01, never a guess; an unconfirmed classification is not
            facts.update(species=product["species"], life_stage=product["life_stage"])
        facts["format"] = product["format"]
        facts["additives"] = self._additives(product_id, formula_digest)
        nodes = [self._checks._node(product_id, ruleset_version, n) for n in node_ids]
        terms = {k: tuple(v) for k, v in accepted_terms(self.conn, ruleset_version).items()}
        return EnvelopeInputs(str(product["workspace_id"]), product_id, ruleset_version, inputs_hash, formula_digest,
                              node_ids, facts, nodes, terms)

    def _additives(self, product_id: str, pinned: str | None) -> list[dict[str, Any]] | None:
        """As PgCheckStore._additives, with each line's ingredient as entered: None when no formula was entered,
        when a line is matched to neither register (#76), or when the formula is no longer the pinned one."""
        rows = self.conn.execute(
            """select f.ingredient, f.feed_material_ref, f.additive_ref, f.amount, f.unit, a.id, a.species,
                      a.max_content, a.expiry, private.formula_digest(f.product_id) as digest
                 from app.formula_lines f left join ref.feed_additives a on a.id = f.additive_ref
                where f.product_id = %s order by f.position, f.id""", (product_id,)).fetchall()
        if pinned is not None and (rows[0]["digest"] if rows else "-") != pinned:
            return None
        if not rows or any(r["feed_material_ref"] is None and r["additive_ref"] is None for r in rows):
            return None
        return [{"additive_ref": r["additive_ref"], "ingredient": r["ingredient"], "amount": _num(r["amount"]),
                 "unit": r["unit"],
                 "register": {"species": list(r["species"]) if r["species"] is not None else None,
                              "max_content": r["max_content"], "expiry": r["expiry"]} if r["id"] else None}
                for r in rows if r["additive_ref"] is not None]

    def write(self, job_id: str, inputs: EnvelopeInputs, nodes: list[NodeEnvelope]) -> str | None:
        """The envelope id, or None when it was already written (by this job, or for the same inputs)."""
        with self.conn.transaction():
            self.conn.execute("select 1 from app.jobs where id = %s for update", (job_id,))
            if self._one("""select 1 from app.envelopes where job_id = %s
                             or (product_id = %s and ruleset_version = %s and inputs_hash = %s) limit 1""",
                         job_id, inputs.product_id, inputs.ruleset_version, inputs.inputs_hash):
                return None
            if self.current_hash(inputs.product_id, inputs.node_ids) != inputs.inputs_hash:
                return None
            env_id = str(self._one(
                """insert into app.envelopes (workspace_id, product_id, ruleset_version, inputs_hash, job_id,
                       formula_digest, node_ids, out_of_scope)
                   values (%s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                inputs.workspace_id, inputs.product_id, inputs.ruleset_version, inputs.inputs_hash, job_id,
                inputs.formula_digest, inputs.node_ids, list(OUT_OF_SCOPE))["id"])
            for n in nodes:
                for i in n.items:
                    self.conn.execute(
                        """insert into app.envelope_items (workspace_id, product_id, envelope_id, node_id, language,
                               kind, rule_key, rule_version, gap_id, provenance, reason_code, citation, payload)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (inputs.workspace_id, inputs.product_id, env_id, i["node_id"], i["language"], i["kind"],
                         i["rule_key"], i["rule_version"], i["gap_id"], i["provenance"], i["reason_code"],
                         i["citation"], Jsonb(i["payload"])))
            for n in nodes:
                self.conn.execute(
                    """insert into app.envelope_nodes (workspace_id, product_id, envelope_id, node_id, state,
                           open_items, withheld) values (%s, %s, %s, %s, %s, %s, %s)""",
                    (inputs.workspace_id, inputs.product_id, env_id, n.node_id, n.state, n.open_items, n.withheld))
            self.conn.execute(
                "select private.write_audit(%s, 'envelope.computed', 'product', %s, null, %s, %s)",
                (inputs.workspace_id, inputs.product_id,
                 Jsonb({"envelope_id": env_id, "job_id": job_id, "states": {n.node_id: n.state for n in nodes}}),
                 inputs.ruleset_version))
        return env_id
