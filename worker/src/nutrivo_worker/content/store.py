"""ref.sources and ref.rule_candidates over DATABASE_URL (service role; staff tooling only, docs/03).

One candidate per (source_id, proposed_rule_key), under an advisory lock held for the whole pair, so two runs never
write the same candidate twice. Writes are limited to `first_value` on insert and `second_value`,
`agree` and `decision` (pending or needs_review) while the candidate is undecided. Nothing here can write
ref.rules or ref.rule_versions or set a decision a person makes."""
from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..db import PgStore
from ..sources.store import BUCKET, StorageClient
from .extract import OPEN_DECISIONS, Candidate, SourceRow


class PgSourceReader:
    def __init__(self, conn, storage: StorageClient):  # type: ignore[no-untyped-def]
        self.conn, self.storage = conn, storage

    def sources(self, act: str, languages: list[str] | None) -> list[SourceRow]:
        """The latest stored text of `act` per language: its newest consolidated version, else the act as published.
        Rows of any kind are returned so the extraction refuses them visibly rather than skipping them silently."""
        with self.conn.cursor(row_factory=dict_row) as cur:
            rows = cur.execute(
                """select distinct on (language) id, kind, celex, language, title, url, sha256, storage_path
                     from ref.sources
                    where (celex = %(act)s or celex like %(consolidated)s)
                      and (%(langs)s::text[] is null or language = any(%(langs)s::text[]))
                    order by language, celex desc, created_at desc""",
                {"act": act, "consolidated": "0" + act[1:] + "-%", "langs": languages}).fetchall()
        return [SourceRow(str(r["id"]), r["kind"], r["celex"], r["language"], r["title"], r["url"], r["sha256"],
                          r["storage_path"]) for r in rows]

    def body(self, row: SourceRow) -> bytes:
        return self.storage.get(BUCKET, row.storage_path or "")


class PgCandidateStore:
    def __init__(self, conn):  # type: ignore[no-untyped-def]
        self.conn = conn

    @contextlib.contextmanager
    def locked(self, source_id: str, rule_key: str) -> Iterator[None]:
        """A session-level lock, not a transaction: each write commits on its own (the connection autocommits), so
        the first value survives a failed second call and the next run resumes there."""
        key = f"ref.rule_candidates:{source_id}:{rule_key}"
        self.conn.execute("select pg_advisory_lock(hashtextextended(%s, 0))", (key,))
        try:
            yield
        finally:
            self.conn.execute("select pg_advisory_unlock(hashtextextended(%s, 0))", (key,))

    def find(self, source_id: str, rule_key: str) -> Candidate | None:
        with self.conn.cursor(row_factory=dict_row) as cur:
            r = cur.execute("""select id, first_value, second_value, decision from ref.rule_candidates
                                where source_id = %s and proposed_rule_key = %s order by created_at limit 1""",
                            (source_id, rule_key)).fetchone()
        return Candidate(str(r["id"]), r["first_value"], r["second_value"], r["decision"]) if r else None

    def insert_first(self, source_id: str, rule_key: str, article: str, source_ref: str,
                     first_value: dict[str, Any]) -> str:
        with self.conn.cursor(row_factory=dict_row) as cur:
            r = cur.execute("""insert into ref.rule_candidates (source_id, article, source_ref, proposed_rule_key,
                                                                first_value)
                               values (%s, %s, %s, %s, %s) returning id""",
                            (source_id, article, source_ref, rule_key, Jsonb(first_value))).fetchone()
        return str(r["id"])

    def set_second(self, candidate_id: str, second_value: dict[str, Any], agree: bool, decision: str) -> bool:
        if decision not in OPEN_DECISIONS:
            raise ValueError(f"extraction never sets decision {decision!r}")
        cur = self.conn.execute("""update ref.rule_candidates set second_value = %s, agree = %s, decision = %s
                                    where id = %s and second_value is null and decision = any(%s)""",
                                (Jsonb(second_value), agree, decision, candidate_id, list(OPEN_DECISIONS)))
        return cur.rowcount == 1

    def insert_model_call(self, row: dict[str, Any]) -> None:
        PgStore(self.conn).insert_model_call(row)
