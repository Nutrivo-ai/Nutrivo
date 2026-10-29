"""Postgres access for the worker: app.jobs state and pgmq messages, over DATABASE_URL (service role or owner).
Every statement is its own short transaction; the reaper's update and requeue share one."""
from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .jobs import Claim, Job, Message, Reaped


def connect(dsn: str) -> psycopg.Connection:
    return psycopg.connect(dsn, autocommit=True, row_factory=dict_row, application_name="nutrivo-worker",
                           connect_timeout=10)


class PgStore:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    @classmethod
    def from_dsn(cls, dsn: str) -> PgStore:
        return cls(connect(dsn))

    def read(self, kind: str, vt_s: int, qty: int) -> list[Message]:
        rows = self.conn.execute("select msg_id, message from pgmq.read(%s, %s, %s)", (kind, vt_s, qty)).fetchall()
        return [Message(r["msg_id"], kind, r["message"] if isinstance(r["message"], dict) else {}) for r in rows]

    def claim(self, job_id: str, stale_after_s: int) -> Claim:
        try:
            row = self.conn.execute(
                """update app.jobs set status = 'running', attempts = attempts + 1, updated_at = now()
                    where id = %s and (status = 'queued'
                                       or (status = 'running' and updated_at < now() - make_interval(secs => %s)))
                returning id, kind, workspace_id, payload, attempts""", (job_id, stale_after_s)).fetchone()
        except psycopg.errors.InvalidTextRepresentation:
            return Claim("missing")              # not a uuid
        if row:
            return Claim("claimed", Job(str(row["id"]), row["kind"],
                                        str(row["workspace_id"]) if row["workspace_id"] else None,
                                        row["payload"] or {}, row["attempts"]))
        cur = self.conn.execute("select status from app.jobs where id = %s", (job_id,)).fetchone()
        if cur is None:
            return Claim("missing")
        return Claim("busy" if cur["status"] in ("running", "queued") else cur["status"])

    def heartbeat(self, job_id: str, progress: dict[str, Any] | None) -> None:
        self.conn.execute("update app.jobs set updated_at = now(), progress = progress || %s where id = %s"
                          " and status = 'running'", (Jsonb(progress or {}), job_id))

    def succeed(self, job_id: str) -> None:
        self.conn.execute("update app.jobs set status = 'succeeded', last_error = null, updated_at = now()"
                          " where id = %s", (job_id,))

    def retry(self, job_id: str, error: str) -> None:
        self.conn.execute("update app.jobs set status = 'queued', last_error = %s, updated_at = now() where id = %s",
                          (error, job_id))

    def fail(self, job_id: str, error: str) -> None:
        self.conn.execute("update app.jobs set status = 'failed', last_error = %s, updated_at = now() where id = %s",
                          (error, job_id))

    def set_vt(self, kind: str, msg_id: int, vt_s: int) -> None:
        self.conn.execute("select pgmq.set_vt(%s, %s, %s)", (kind, msg_id, vt_s))

    def delete(self, kind: str, msg_id: int) -> None:
        self.conn.execute("select pgmq.delete(%s, %s::bigint)", (kind, msg_id))

    def archive(self, kind: str, msg_id: int) -> None:
        self.conn.execute("select pgmq.archive(%s, %s::bigint)", (kind, msg_id))

    def reap(self, stale_after_s: int, max_attempts: int) -> list[Reaped]:
        with self.conn.transaction():
            rows = self.conn.execute(
                """with stale as (
                     select id from app.jobs
                      where status = 'running' and updated_at < now() - make_interval(secs => %(stale)s)
                      for update skip locked)
                   update app.jobs j
                      set status = case when j.attempts >= %(max)s then 'failed' else 'queued' end,
                          last_error = case when j.attempts >= %(max)s
                                            then 'Reaped: running past the lease with no attempts left'
                                            else 'Reaped: running past the lease, requeued' end,
                          updated_at = now()
                     from stale where j.id = stale.id
                   returning j.id, j.kind, j.status, j.attempts""",
                {"stale": stale_after_s, "max": max_attempts}).fetchall()
            for r in rows:
                if r["status"] == "queued":
                    self.conn.execute("select pgmq.send(%s, %s::jsonb)",
                                      (r["kind"], json.dumps({"job_id": str(r["id"])})))
        return [Reaped(str(r["id"]), r["kind"], r["status"], r["attempts"]) for r in rows]

    def insert_model_call(self, row: dict[str, Any]) -> None:
        self.conn.execute(
            """insert into app.model_calls (workspace_id, purpose, provider, model_id, prompt_version, input_hash,
                                            output, input_tokens, output_tokens, cost_eur, latency_ms)
               values (%(workspace_id)s, %(purpose)s, %(provider)s, %(model_id)s, %(prompt_version)s, %(input_hash)s,
                       %(output)s, %(input_tokens)s, %(output_tokens)s, %(cost_eur)s, %(latency_ms)s)""",
            {**row, "output": Jsonb(row.get("output"))})

    def job_progress(self, job_id: str) -> dict[str, Any]:
        row = self.conn.execute("select progress from app.jobs where id = %s", (job_id,)).fetchone()
        return (row["progress"] or {}) if row else {}

    # ── notify (A03) ────────────────────────────────────────────────────────────────────────────────────
    def invitation_for_email(self, invitation_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select i.id::text, i.workspace_id::text, i.email::text, i.role, i.expires_at, i.accepted_at,
                      i.revoked_at, w.name as workspace_name, p.display_name as inviter_name
                 from app.invitations i
                 join app.workspaces w on w.id = i.workspace_id
                 join app.people p on p.id = i.invited_by
                where i.id = %s""", (invitation_id,)).fetchone()

    def set_invitation_token(self, invitation_id: str, token_hash: bytes) -> bool:
        """Store the hash of a new token, only while the invitation is pending. A revoke holding the row wins."""
        row = self.conn.execute(
            """update app.invitations set token_hash = %s
                where id = %s and accepted_at is null and revoked_at is null and expires_at > now()
            returning id""", (token_hash, invitation_id)).fetchone()
        return row is not None

    def notification_prefs(self, person_ids: list[str], kind: str) -> dict[tuple[str, str], bool]:
        rows = self.conn.execute(
            """select person_id::text, channel, enabled from app.notification_prefs
                where person_id = any(%s::uuid[]) and kind = %s""", (person_ids, kind)).fetchall()
        return {(r["person_id"], r["channel"]): r["enabled"] for r in rows}

    def insert_notifications(self, job_id: str, workspace_id: str, kind: str, severity: str,
                             rows: list[tuple[str, dict[str, Any]]]) -> int:
        """One delivery's in-app rows and progress.in_app in one transaction, so a retry never writes a row twice.
        Each row is written only while its person is an active member of the workspace."""
        with self.conn.transaction():
            n = 0
            for person_id, object_ref in rows:
                n += self.conn.execute(
                    """insert into app.notifications (workspace_id, person_id, kind, severity, object_ref)
                       select %(ws)s, %(p)s, %(kind)s, %(sev)s, %(ref)s
                        where exists (select 1 from app.memberships m
                                       where m.workspace_id = %(ws)s and m.person_id = %(p)s and m.ended_at is null
                                         and (m.access_ends_at is null or m.access_ends_at > now()))""",
                    {"ws": workspace_id, "p": person_id, "kind": kind, "sev": severity,
                     "ref": Jsonb(object_ref)}).rowcount
            self.conn.execute("update app.jobs set updated_at = now(), progress = progress || %s where id = %s",
                              (Jsonb({"in_app": n}), job_id))
        return n

    def share_for_email(self, share_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select s.id::text, s.workspace_id::text, s.report_id::text, s.channel, s.recipient, s.expires_at,
                      s.revoked_at, w.name as workspace_name, p.display_name as sender_name
                 from app.shares s
                 join app.workspaces w on w.id = s.workspace_id
                 left join app.people p on p.id = s.created_by and p.tombstoned_at is null
                      and exists (select 1 from app.memberships m
                                   where m.workspace_id = s.workspace_id and m.person_id = p.id and m.ended_at is null
                                     and (m.access_ends_at is null or m.access_ends_at > now()))
                where s.id = %s""", (share_id,)).fetchone()

    def set_share_token(self, share_id: str, token_hash: bytes) -> bool:
        """Store the hash of a new token while the emailed share is live. A revoke holding the row wins."""
        row = self.conn.execute(
            """update app.shares set token_hash = %s
                where id = %s and channel = 'email' and revoked_at is null and (expires_at is null or expires_at > now())
            returning id""", (token_hash, share_id)).fetchone()
        return row is not None

    def report_summary(self, report_id: str, workspace_id: str) -> dict[str, Any] | None:
        """Template 01's counts over the report's pinned checks (docs/04-contracts.md), within the share's workspace."""
        return self.conn.execute(
            """with r as (select * from app.reports where id = %s and workspace_id = %s),
                    c as (select c.* from app.checks c join r on c.id = any(r.check_ids)
                           where c.workspace_id = r.workspace_id)
               select pr.name as product, r.ruleset_version, r.created_at as checked_at,
                      (select count(distinct c.node_id) from c)::int as markets,
                      (select count(distinct c.panel_id) from c)::int as panels,
                      (select coalesce(sum(cardinality(c.passed_rule_keys)), 0) from c)::int as clear,
                      (select count(*) from app.check_findings f join c on c.id = f.check_id
                        where f.state = 'action')::int as action,
                      (select count(*) from app.check_findings f join c on c.id = f.check_id
                        where f.state = 'not_assessed')::int as not_assessed,
                      (select count(*) from app.product_nodes pn
                        where pn.product_id = r.product_id and pn.display_state = 'blocked'
                          and pn.node_id in (select c.node_id from c))::int as blocked
                 from r join app.products pr on pr.id = r.product_id""", (report_id, workspace_id)).fetchone()

    def rule_diff(self, rule_diff_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select rd.id::text, rd.effect_type, rd.effective_from, r.title as rule_title, j.name as held_in
                 from ref.rule_diffs rd
                 join ref.rules r on r.rule_key = rd.rule_key
                 join ref.jurisdictions j on j.id = r.node_id
                where rd.id = %s""", (rule_diff_id,)).fetchone()

    def rule_change_recipients(self, rule_diff_id: str, workspace_id: str) -> list[dict[str, Any]]:
        """Contract 5 (app.affected_objects) joined to each active member whose scope holds the product's recipe and
        market, the same test as private.family_in_scope and private.node_in_scope."""
        return self.conn.execute(
            """select p.id::text as person_id, p.email::text as email, ao.product_id::text, pr.name as product_name,
                      ao.node_id
                 from app.affected_objects(%s) ao
                 join app.products pr on pr.id = ao.product_id
                 join app.memberships m on m.workspace_id = ao.workspace_id and m.ended_at is null
                      and (m.access_ends_at is null or m.access_ends_at > now())
                      and (m.scope_family_ids is null or pr.family_id = any(m.scope_family_ids))
                      and (m.scope_node_ids is null or ao.node_id = any(m.scope_node_ids)
                           or (select j.parent_id from ref.jurisdictions j where j.id = ao.node_id)
                              = any(m.scope_node_ids))
                 join app.people p on p.id = m.person_id and p.tombstoned_at is null and p.email is not null
                where ao.workspace_id = %s
                order by 1, 4, 5""", (rule_diff_id, workspace_id)).fetchall()

    def document_for_notice(self, document_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            # display_name: app.supplier_documents.doc_type is a key and nothing stores a document's human name yet
            # (a founder item on the T-602 pull request), so Template 04 fails visibly rather than print the key.
            """select d.id::text, d.workspace_id::text, d.doc_type, null::text as display_name, d.valid_to,
                      s.name as supplier_name,
                      (select count(distinct pr.family_id) from app.products pr
                        where pr.id = d.product_id
                           or pr.id in (select g.product_id from app.registrations g
                                         where g.evidence_doc_id = d.id))::int as recipes,
                      (select count(*) from app.registrations g where g.evidence_doc_id = d.id)::int as registrations
                 from app.supplier_documents d
                 left join app.suppliers s on s.id = d.supplier_id
                where d.id = %s""", (document_id,)).fetchone()

    def members_for_notice(self, workspace_id: str, person_ids: list[str], admins: bool) -> list[dict[str, Any]]:
        return self.conn.execute(
            """select distinct p.id::text as person_id, p.email::text as email
                 from app.memberships m join app.people p on p.id = m.person_id
                where m.workspace_id = %s and m.ended_at is null
                  and (m.access_ends_at is null or m.access_ends_at > now())
                  and p.tombstoned_at is null and p.email is not null
                  and (m.person_id = any(%s::uuid[]) or (%s and m.role = 'admin'))
                order by 1""", (workspace_id, person_ids, admins)).fetchall()

    def allowance_for_notice(self, workspace_id: str) -> dict[str, Any] | None:
        """The free allowance, the workspace's checks, and its creator while they are still an active member."""
        return self.conn.execute(
            """select a.labels_used, a.labels_allowed,
                      (select count(*) from app.checks c where c.workspace_id = a.workspace_id)::int as checks,
                      p.id::text as creator_person_id, p.email::text as creator_email
                 from app.allowances a
                 join app.workspaces w on w.id = a.workspace_id
                 left join app.people p on p.id = w.created_by and p.tombstoned_at is null and p.email is not null
                      and exists (select 1 from app.memberships m
                                   where m.workspace_id = w.id and m.person_id = p.id and m.ended_at is null
                                     and (m.access_ends_at is null or m.access_ends_at > now()))
                where a.workspace_id = %s""", (workspace_id,)).fetchone()

    def payment_for_receipt(self, payment_event_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select e.workspace_id::text, e.type, e.payload, s.plan, s.term, s.current_period_end
                 from app.payment_events e left join app.subscriptions s on s.workspace_id = e.workspace_id
                where e.stripe_event_id = %s""", (payment_event_id,)).fetchone()

    def invoice_pdf(self, payment_event_id: str) -> bytes | None:
        """Where the invoice PDF comes from is in the T-602 pull request's founder items (no Stripe fetch from here),
        so there is none yet, and Template 06 fails rather than sending a receipt without it."""
        return None

    # ── billing_sync, billing_reconcile (T-702) ─────────────────────────────────────────────────────────────
    def payment_event(self, stripe_event_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select workspace_id::text, type, payload from app.payment_events where stripe_event_id = %s""",
            (stripe_event_id,)).fetchone()

    def workspace_for_subscription(self, subscription_id: str, customer_id: str | None) -> str | None:
        row = self.conn.execute("select private.stripe_workspace(%s)::text as ws",
                                (Jsonb({"object": "subscription", "id": subscription_id, "customer": customer_id}),)
                                ).fetchone()
        return row["ws"] if row else None

    def apply_subscription(self, workspace_id: str, snapshot: dict[str, Any], source: str, ref: str) -> str:
        return self.conn.execute("select app.apply_subscription(%s, %s, %s, %s) as outcome",
                                 (workspace_id, Jsonb(snapshot), source, ref)).fetchone()["outcome"]

    # ── session_revoke (A06) ────────────────────────────────────────────────────────────────────────────
    def membership_for_revoke(self, membership_id: str) -> dict[str, Any] | None:
        return self.conn.execute(
            """select m.id::text, m.workspace_id::text, m.person_id::text, m.ended_at, p.user_id::text
                 from app.memberships m join app.people p on p.id = m.person_id
                where m.id = %s""", (membership_id,)).fetchone()

    def revoke_sessions(self, user_id: str, created_before: Any) -> int:
        """Sign a user out: their sessions (and, by cascade, refresh tokens) from before the membership ended."""
        cur = self.conn.execute("delete from auth.sessions where user_id = %s and created_at <= %s",
                                (user_id, created_before))
        return cur.rowcount
