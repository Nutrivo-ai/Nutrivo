"""A person records a horizon item from a source-watch report (J01 step 3): `nutrivo horizon record`.

The stage and the dates are the person's, given on the command line; nothing comes from the model's summary, which is
never stored. BE-37 holds twice: only a stage of adopted, published or in_force may carry an effective date (the
table's own check says the same), and a proposal or preparatory document is never recorded at a law stage, because
the document itself never becomes law (the act adopted from it has its own CELEX id).
Idempotent by (celex, stage) under an advisory lock: the same recording again gives `unchanged` and no new row."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

from psycopg.rows import dict_row

from ..errors import SafeError

STAGES = ("proposal", "draft", "consultation", "adopted", "published", "in_force")
LAW_STAGES = frozenset({"adopted", "published", "in_force"})
NEVER_LAW_KINDS = frozenset({"proposal", "preparatory"})


class RecordRefused(SafeError):
    def __init__(self, message: str, reason: str):
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class Recording:
    celex: str
    kind: str
    title: str
    stage: str
    expected_date: date | None = None
    effective_from: date | None = None
    notes: str | None = None


def report_item(report_path: Path, celex: str) -> dict[str, Any]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    item = next((i for i in report.get("items") or [] if i.get("celex") == celex), None)
    if item is None:
        raise RecordRefused(f"{celex[:40]} is not in the report {report_path.name}", "not_in_report")
    return item


def recording(item: dict[str, Any], stage: str, *, expected_date: date | None = None,
              effective_from: date | None = None, notes: str | None = None) -> Recording:
    """The row a person asked for, refused when it would show a proposal as law or with an effective date."""
    if stage not in STAGES:
        raise RecordRefused(f"stage {stage[:40]!r} is not one of {', '.join(STAGES)}", "bad_stage")
    if effective_from is not None and stage not in LAW_STAGES:
        raise RecordRefused(f"a {stage} has no effective date (BE-37)", "effective_date_on_non_law")
    kind = str(item.get("kind") or "other")
    if kind in NEVER_LAW_KINDS and stage in LAW_STAGES:
        raise RecordRefused(f"{item['celex']} is a {kind} document and is never {stage} (BE-37)", "proposal_as_law")
    title = item.get("title") or item["celex"]
    return Recording(item["celex"], kind, title, stage, expected_date, effective_from, notes)


Recorded = tuple[Literal["recorded", "unchanged"], str]


class PgHorizonStore:
    def __init__(self, conn):  # type: ignore[no-untyped-def]
        self.conn = conn

    def known_celex(self) -> set[str]:
        rows = self.conn.execute("select distinct celex from ref.horizon_items where celex is not null").fetchall()
        return {r["celex"] for r in rows}

    def record(self, r: Recording) -> Recorded:
        with self.conn.transaction(), self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (f"ref.horizon_items:{r.celex}:{r.stage}",))
            row = cur.execute("select id from ref.horizon_items where celex = %s and stage = %s order by created_at"
                              " limit 1", (r.celex, r.stage)).fetchone()
            if row:
                return "unchanged", str(row["id"])
            row = cur.execute(
                """insert into ref.horizon_items (title, stage, expected_date, effective_from, celex, notes)
                   values (%s, %s, %s, %s, %s, %s) returning id""",
                (r.title, r.stage, r.expected_date, r.effective_from, r.celex, r.notes)).fetchone()
            return "recorded", str(row["id"])
