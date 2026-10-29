"""Reads and the one write of a label report, over the worker's connection (service role). Every read is scoped by
the check's own workspace; the job's workspace must be that one (service.generate refuses anything else)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg.types.json import Jsonb

from .model import Events, Snapshot


class PgReportStore:
    def __init__(self, conn: Any):
        self.conn = conn

    def _one(self, query: str, *args: Any) -> dict[str, Any] | None:
        return self.conn.execute(query, args).fetchone()

    def job(self, job_id: str) -> dict[str, Any] | None:
        return self._one("select progress, requested_by from app.jobs where id = %s", job_id)

    def report_for_job(self, job_id: str) -> dict[str, Any] | None:
        return self._one("select * from app.reports where job_id = %s", job_id)

    def report_by_ref(self, ref: str) -> dict[str, Any] | None:
        return self._one("select * from app.reports where ref = %s", ref)

    def check(self, check_id: str) -> dict[str, Any] | None:
        return self._one("select * from app.checks where id = %s", check_id)

    def events(self, check: dict[str, Any]) -> Events:
        ws = check["workspace_id"]
        findings = self.conn.execute("select * from app.check_findings where check_id = %s and workspace_id = %s",
                                     (check["id"], ws)).fetchall()
        keys = sorted({*check["applied_rule_keys"], *check["passed_rule_keys"], *check["withheld_rule_keys"],
                       *(f["rule_key"] for f in findings if f["rule_key"])})
        rules = self.conn.execute(
            """select m.rule_key, m.version, v.article_ref
                 from ref.ruleset_members m
                 join ref.rule_versions v on v.rule_key = m.rule_key and v.version = m.version
                where m.ruleset_version = %s and m.rule_key = any(%s)""",
            (check["ruleset_version"], keys)).fetchall()
        classification = None
        if check["classification_id"]:
            classification = self._one("select * from app.classifications where id = %s and workspace_id = %s",
                                       check["classification_id"], ws)
        siblings = []
        if check["job_id"]:
            siblings = self.conn.execute(
                """select c.id, c.node_id, c.language, c.label_state,
                          (select count(*) from app.check_findings f
                            where f.check_id = c.id and f.state = 'action') as open_findings
                     from app.checks c
                    where c.job_id = %s and c.workspace_id = %s and c.id <> %s""",
                (check["job_id"], ws, check["id"])).fetchall()
        return Events(check=check, findings=findings,
                      rule_versions={r["rule_key"]: r for r in rules}, classification=classification,
                      siblings=siblings)

    def snapshot(self, check: dict[str, Any], events: Events, requested_by: Any) -> Snapshot:
        ws = check["workspace_id"]
        product = self._one("select name from app.products where id = %s and workspace_id = %s",
                            check["product_id"], ws)
        artwork = None
        if check["artwork_version_id"]:
            artwork = self._one("select version from app.artwork_versions where id = %s and workspace_id = %s",
                                check["artwork_version_id"], ws)
        node_ids = sorted({check["node_id"], *(s["node_id"] for s in events.siblings)})
        nodes = {r["id"]: r["name"] for r in self.conn.execute(
            "select id, name from ref.jurisdictions where id = any(%s)", (node_ids,)).fetchall()}
        titles = {r["rule_key"]: r["title"] for r in self.conn.execute(
            "select rule_key, title from ref.rules where rule_key = any(%s)",
            (sorted({*events.rule_versions, *(f["rule_key"] for f in events.findings if f["rule_key"]),
                     *check["withheld_rule_keys"]}),)).fetchall()}
        gaps = {r["gap_id"]: r for r in self.conn.execute(
            "select gap_id, reason_code, description from ref.coverage_gaps where gap_id = any(%s)",
            (sorted({f["gap_id"] for f in events.findings if f["gap_id"]}),)).fetchall()}
        text_ids = sorted({f["text_object_id"] for f in events.findings if f["text_object_id"]})
        texts = {str(r["id"]): r for r in self.conn.execute(
            "select id, text, bbox_mm from app.text_objects where id = any(%s) and workspace_id = %s",
            (text_ids, ws)).fetchall()}
        count = 0
        if check["panel_id"]:
            count = self._one("select count(*) as n from app.text_objects where panel_id = %s and workspace_id = %s",
                              check["panel_id"], ws)["n"]   # type: ignore[index]
        market = self._one("select registration_state from app.product_nodes where product_id = %s and node_id = %s"
                           " and workspace_id = %s", check["product_id"], check["node_id"], ws)
        person = None
        if requested_by:
            person = self._one("select display_name from app.people where id = %s and tombstoned_at is null",
                               requested_by)
        return Snapshot(
            product_name=product["name"] if product else "Unknown product",
            artwork_version=artwork["version"] if artwork else None,
            node_name=nodes.get(check["node_id"], check["node_id"]), node_names=nodes, rule_titles=titles,
            gaps=gaps, text_objects=texts, text_object_count=int(count),
            registration_state=market["registration_state"] if market else "unknown",
            requested_by=person["display_name"] if person else None)

    def insert(self, model: dict[str, Any], *, product_id: Any, job_id: str, created_by: Any, issued_at: datetime,
               pdf_path: str, pdf_sha256: str) -> str:
        """The report row and its audit event, in one transaction. Insert-only: never updated afterwards."""
        with self.conn.transaction():
            report_id = self._one(
                """insert into app.reports (workspace_id, product_id, node_id, ref, job_id, check_ids, ruleset_version,
                                            artwork_sha, has_not_assessed, pdf_path, pdf_sha256, created_by,
                                            created_at)
                   values (%s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s, %s, %s, %s, %s) returning id""",
                model["workspace_id"], product_id, model["node_id"], model["ref"], job_id, model["check_ids"],
                model["ruleset_version"], model["artwork_sha"], model["has_not_assessed"], pdf_path, pdf_sha256,
                created_by, issued_at)["id"]   # type: ignore[index]
            self.conn.execute(
                "select private.write_audit(%s, 'report.generated', 'report', %s, null, %s, %s)",
                (model["workspace_id"], str(report_id),
                 Jsonb({"ref": model["ref"], "check_ids": model["check_ids"], "artwork_sha": model["artwork_sha"],
                        "pdf_sha256": pdf_sha256, "job_id": job_id}), model["ruleset_version"]))
        return str(report_id)
