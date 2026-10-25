"""notify: the six emails (design/public/Nutrivo Email Templates.dc.html) and the in-app notifications (O01, BE-39).

Templates: `invitation` (02, A03), `report` (01, I02), `rule_changed` (03, J03), `document_expiring` (04, H04),
`allowance_used` (05, B02) and `receipt` (06, M03). Each producer task enqueues its own job; docs/04-contracts.md
gives every payload, key and outcome. Payloads hold ids only.

One delivery (`deliver`): an `app.notifications` row for each recipient who is a member, written together with
progress.in_app in one transaction so a retry never writes a second row, then one email per recipient, each recorded
in progress.emailed (person ids) as it goes, so a retry never emails anybody twice. An address the provider rejects
for good is recorded in progress.rejected and the others still get theirs (outcome `partly_sent`, reported to Sentry
as a warning); when nobody could be emailed the job fails. Account-level provider errors retry, then fail. Templates 03 and 04 honour each
person's notification_prefs per channel (a missing row means enabled); 01, 02, 05 and 06 always send. Recipients who
are not members (a report's addressee, an invoice's payer) get the email and no row.

The invitation (and a report sent by email) mints its token here, stores only its hash and emails it: the token exists
in this process's memory and in the email, nowhere else (docs/09). Sending errors retry from the queue with backoff
(docs/18); a job that cannot be delivered at all fails with a safe error."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol

import sentry_sdk

from .. import email_templates, mail
from ..errors import PermanentJobError
from ..jobs import Job, JobContext, handler
from ..logs import get_logger, kv

log = get_logger(__name__)

TOKEN_BYTES = 32   # docs/09


class NotifyStore(Protocol):
    def job_progress(self, job_id: str) -> dict[str, Any]: ...
    def invitation_for_email(self, invitation_id: str) -> dict[str, Any] | None: ...
    def set_invitation_token(self, invitation_id: str, token_hash: bytes) -> bool: ...
    def notification_prefs(self, person_ids: list[str], kind: str) -> dict[tuple[str, str], bool]: ...
    def insert_notifications(self, job_id: str, workspace_id: str, kind: str, severity: str,
                             rows: list[tuple[str, dict[str, Any]]]) -> int: ...
    def share_for_email(self, share_id: str) -> dict[str, Any] | None: ...
    def set_share_token(self, share_id: str, token_hash: bytes) -> bool: ...
    def report_summary(self, report_id: str, workspace_id: str) -> dict[str, Any] | None: ...
    def rule_diff(self, rule_diff_id: str) -> dict[str, Any] | None: ...
    def rule_change_recipients(self, rule_diff_id: str, workspace_id: str) -> list[dict[str, Any]]: ...
    def document_for_notice(self, document_id: str) -> dict[str, Any] | None: ...
    def members_for_notice(self, workspace_id: str, person_ids: list[str], admins: bool) -> list[dict[str, Any]]: ...
    def allowance_for_notice(self, workspace_id: str) -> dict[str, Any] | None: ...
    def payment_for_receipt(self, payment_event_id: str) -> dict[str, Any] | None: ...
    def invoice_pdf(self, payment_event_id: str) -> bytes | None: ...


SHARE_PATH = "/share/"   # the shared-report page T-601 serves; the route is in the T-602 PR's founder items


def new_token() -> tuple[str, bytes]:
    """32 random bytes, URL-safe; the database finds the invitation or share by sha256 of this text."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hashlib.sha256(token.encode()).digest()


def payload_uuid(value: Any, name: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise PermanentJobError(f"payload {name} is not a uuid") from None


def payload_uuids(value: Any, name: str) -> list[str]:
    if not isinstance(value, list):
        raise PermanentJobError(f"payload {name} is not a list")
    return sorted({payload_uuid(v, name) for v in value})


def _done(ctx: JobContext, outcome: str, **counts: Any) -> None:
    ctx.heartbeat(outcome=outcome, **counts)
    log.info("notify finished", extra=kv(outcome=outcome, **counts))


def _same_workspace(job: Job, workspace_id: str | None, what: str) -> str:
    """The job's workspace, which must be the object's: every notify job names one (docs/04-contracts.md)."""
    if not job.workspace_id:
        raise PermanentJobError("the job names no workspace")
    if workspace_id != job.workspace_id:
        raise PermanentJobError(f"{what} belongs to another workspace")
    return job.workspace_id


# ── One delivery: in-app rows, then emails ─────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Recipient:
    key: str                                  # the person id, or "recipient" for an address with no account here
    email: str | None
    person_id: str | None = None              # set only for an active member: they get an in-app row
    object_ref: dict[str, Any] = field(default_factory=dict)   # ids only; members read their own rows


@dataclass(frozen=True)
class Delivery:
    kind: str                                 # app.notifications.kind and notification_prefs.kind
    recipients: list[Recipient]
    render: Callable[[Recipient], mail.Email]
    gated: bool = False                       # honours notification_prefs (Templates 03 and 04)
    severity: str = "info"


def deliver(job: Job, ctx: JobContext, store: NotifyStore, d: Delivery, mailer: mail.Mailer | None = None) -> None:
    progress = store.job_progress(job.id)
    members = [r for r in d.recipients if r.person_id]
    prefs = store.notification_prefs([r.person_id for r in members if r.person_id], d.kind) \
        if d.gated and members else {}

    def on(r: Recipient, channel: str) -> bool:
        return r.person_id is None or prefs.get((r.person_id, channel), True)

    if "in_app" in progress:
        in_app = int(progress["in_app"])
    else:
        rows = [(r.person_id, r.object_ref) for r in members if r.person_id and on(r, "in_app")]
        in_app = store.insert_notifications(job.id, _same_workspace(job, job.workspace_id, "the job"), d.kind,
                                            d.severity, rows) if rows else 0
        if not rows:
            ctx.heartbeat(in_app=0)
    emailed: list[str] = list(progress.get("emailed", []))
    rejected: list[str] = list(progress.get("rejected", []))
    due = [r for r in d.recipients if r.key not in emailed + rejected and r.email and on(r, "email")]
    if due:
        mailer = mailer or mail.mailer_for(ctx.settings)
    for r in due:
        try:
            message_id = mail.send(mailer, d.render(r))  # type: ignore[arg-type]  # set whenever anything is due
        except mail.RecipientRejectedError as exc:   # this address can never succeed: record it, carry on
            rejected.append(r.key)
            ctx.heartbeat(rejected=rejected)
            log.warning("notify email rejected", extra=kv(recipient=r.key, error=str(exc)))
            continue
        emailed.append(r.key)
        ctx.heartbeat(emailed=emailed)
        log.info("notify email sent", extra=kv(recipient=r.key, message_id=message_id or ""))
    if rejected and not emailed:
        raise PermanentJobError(f"no recipient could be emailed ({len(rejected)} rejected)")
    ctx.heartbeat(email="sent")
    if rejected:
        sentry_sdk.capture_message(f"notify {d.kind}: {len(rejected)} of {len(rejected) + len(emailed)} recipients "
                                   "rejected", level="warning")
    _done(ctx, "partly_sent" if rejected else "sent", in_app=in_app, emails=len(emailed),
          **({"rejections": len(rejected)} if rejected else {}))


# ── Template 02 · invitation (A03) ─────────────────────────────────────────────────────────────────────
def send_invitation(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    invitation_id = payload_uuid(job.payload.get("invitation_id"), "invitation_id")
    if store.job_progress(job.id).get("email") == "sent":
        return _done(ctx, "already_sent")
    inv = store.invitation_for_email(invitation_id)
    if inv is None:
        raise PermanentJobError(f"invitation {invitation_id} does not exist")
    _same_workspace(job, inv["workspace_id"], f"invitation {invitation_id}")
    if inv["revoked_at"] is not None:
        return _done(ctx, "skipped_revoked")
    if inv["accepted_at"] is not None:
        return _done(ctx, "skipped_accepted")
    if inv["expires_at"] <= datetime.now(UTC):
        return _done(ctx, "skipped_expired")

    mailer = mailer or mail.mailer_for(ctx.settings)
    base_url = ctx.settings.require_app_base_url()
    token, token_hash = new_token()
    if not store.set_invitation_token(invitation_id, token_hash):
        return _done(ctx, "skipped_not_pending")   # revoked, accepted or expired since it was read
    email = email_templates.invitation(to=inv["email"], inviter=inv["inviter_name"], workspace=inv["workspace_name"],
                                       role=inv["role"], expires_at=inv["expires_at"],
                                       url=f"{base_url}/invite/{token}")
    message_id = mail.send(mailer, email)
    ctx.heartbeat(email="sent", outcome="sent", **({"message_id": message_id} if message_id else {}))
    log.info("invitation email sent", extra=kv(invitation_id=invitation_id))


# ── Template 01 · report (I02) ─────────────────────────────────────────────────────────────────────────
def send_report(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    """A report shared by email. Like the invitation, the share's token is minted here; a retry after a failed send
    mints a new one, which replaces the undelivered one. A revoked or expired share is a recorded no-op."""
    share_id = payload_uuid(job.payload.get("share_id"), "share_id")
    progress = store.job_progress(job.id)
    if progress.get("email") == "sent" or "recipient" in progress.get("emailed", []):
        return _done(ctx, "already_sent")   # never mint again: that would kill the link already delivered
    share = store.share_for_email(share_id)
    if share is None:
        raise PermanentJobError(f"share {share_id} does not exist")
    _same_workspace(job, share["workspace_id"], f"share {share_id}")
    if share["channel"] != "email" or not share["recipient"]:
        raise PermanentJobError(f"share {share_id} is not addressed to an email")
    if not share["sender_name"]:
        raise PermanentJobError(f"share {share_id} names no sender")
    if share["revoked_at"] is not None:
        return _done(ctx, "skipped_revoked")
    if share["expires_at"] is not None and share["expires_at"] <= datetime.now(UTC):
        return _done(ctx, "skipped_expired")
    summary = store.report_summary(share["report_id"], share["workspace_id"])
    if summary is None:
        raise PermanentJobError(f"report of share {share_id} does not exist")
    base_url = ctx.settings.require_app_base_url()
    token, token_hash = new_token()
    if not store.set_share_token(share_id, token_hash):
        return _done(ctx, "skipped_not_pending")   # revoked or expired since it was read
    email = email_templates.report(to=share["recipient"], sender=share["sender_name"],
                                   workspace=share["workspace_name"],
                                   summary=email_templates.ReportSummary(**summary),
                                   url=f"{base_url}{SHARE_PATH}{token}")
    deliver(job, ctx, store, Delivery("report_sent", [Recipient("recipient", share["recipient"])], lambda r: email),
            mailer)


# ── Template 03 · rule_changed (J03; O01.must.1) ───────────────────────────────────────────────────────
def send_rule_changed(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    """One material rule diff for one workspace: each active member with an affected product in scope gets a row and
    an email naming their recipes. An editorial diff never notifies (O01.must.1), and a diff that touches none of the
    workspace's products sends nothing ("An alert names recipes or it is not sent"). When to enqueue, and so the
    daily batching, is the producer's (J03, T-901)."""
    diff_id = payload_uuid(job.payload.get("rule_diff_id"), "rule_diff_id")
    if store.job_progress(job.id).get("email") == "sent":
        return _done(ctx, "already_sent")
    diff = store.rule_diff(diff_id)
    if diff is None:
        raise PermanentJobError(f"rule diff {diff_id} does not exist")
    if diff["effect_type"] == "editorial":
        return _done(ctx, "skipped_editorial")
    ws = _same_workspace(job, job.workspace_id, "the job")
    people: dict[str, dict[str, Any]] = {}
    for row in store.rule_change_recipients(diff_id, ws):
        p = people.setdefault(row["person_id"], {"email": row["email"], "products": {}, "nodes": set()})
        p["products"][row["product_id"]] = row["product_name"]
        p["nodes"].add(row["node_id"])
    if not people:
        return _done(ctx, "skipped_no_impact")
    base_url, today = ctx.settings.require_app_base_url(), datetime.now(UTC).date()
    recipients = [Recipient(pid, p["email"], pid, {"rule_diff_id": diff_id, "product_ids": sorted(p["products"])})
                  for pid, p in sorted(people.items())]

    def render(r: Recipient) -> mail.Email:
        p = people[r.key]
        products = sorted(p["products"].items(), key=lambda kv: kv[1])
        url = (f"{base_url}/w/{ws}/products/{products[0][0]}" if len(products) == 1 else f"{base_url}/w/{ws}/alerts")
        return email_templates.rule_changed(
            to=p["email"], effect_type=diff["effect_type"], held_in=diff["held_in"], rule_title=diff["rule_title"],
            effective_from=diff["effective_from"], recipes=[name for _, name in products],
            markets=sorted(p["nodes"]), url=url, today=today)

    deliver(job, ctx, store, Delivery("rule_changed", recipients, render, gated=True, severity="warning"), mailer)


# ── Template 04 · document_expiring (H04) ──────────────────────────────────────────────────────────────
def send_document_expiring(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    """A notice at 60, 30 or 7 days to the people the producer names as owning the document pack, plus the admins on
    the 7-day notice only. A document that is not expiring at that notice is a recorded no-op."""
    document_id = payload_uuid(job.payload.get("document_id"), "document_id")
    days = job.payload.get("notice_days")
    if days not in email_templates.NOTICE_DAYS:
        raise PermanentJobError("payload notice_days is not 60, 30 or 7")
    owners = payload_uuids(job.payload.get("person_ids", []), "person_ids")
    if store.job_progress(job.id).get("email") == "sent":
        return _done(ctx, "already_sent")
    doc = store.document_for_notice(document_id)
    if doc is None:
        raise PermanentJobError(f"document {document_id} does not exist")
    ws = _same_workspace(job, doc["workspace_id"], f"document {document_id}")
    if not doc["display_name"]:
        raise PermanentJobError(f"document {document_id} has no display name")   # never print a doc_type key
    expires_on: date | None = doc["valid_to"]
    remaining = (expires_on - datetime.now(UTC).date()).days if expires_on else -1
    if not 0 <= remaining <= days:
        return _done(ctx, "skipped_not_expiring")   # no expiry, already expired, or not yet due
    people = store.members_for_notice(ws, owners, admins=days == 7)
    if not people:
        return _done(ctx, "skipped_no_recipient")
    url = f"{ctx.settings.require_app_base_url()}/w/{ws}/documents"
    ref = {"document_id": document_id, "notice_days": days}
    recipients = [Recipient(p["person_id"], p["email"], p["person_id"], ref) for p in people]

    def render(r: Recipient) -> mail.Email:
        return email_templates.document_expiring(
            to=r.email or "", document=doc["display_name"], supplier=doc["supplier_name"], expires_on=expires_on,
            days=remaining, recipes=doc["recipes"], registrations=doc["registrations"], url=url,
            owner=r.key in owners)

    deliver(job, ctx, store, Delivery("document_expiring", recipients, render, gated=True, severity="warning"),
            mailer)


# ── Template 05 · allowance_used (B02) ─────────────────────────────────────────────────────────────────
def send_allowance_used(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    """Once, when the workspace's last free label is used, to its creator while they are still a member."""
    if store.job_progress(job.id).get("email") == "sent":
        return _done(ctx, "already_sent")
    ws = _same_workspace(job, job.workspace_id, "the job")
    a = store.allowance_for_notice(ws)
    if a is None:
        raise PermanentJobError("the workspace has no allowance")
    if a["labels_used"] < a["labels_allowed"]:
        return _done(ctx, "skipped_not_used_up")
    if a["creator_person_id"] is None:
        return _done(ctx, "skipped_no_recipient")
    url = f"{ctx.settings.require_app_base_url()}/w/{ws}/billing/plans"
    email = email_templates.allowance_used(to=a["creator_email"], labels=a["labels_allowed"], checks=a["checks"],
                                           url=url)
    who = Recipient(a["creator_person_id"], a["creator_email"], a["creator_person_id"], {"workspace_id": ws})
    deliver(job, ctx, store, Delivery("allowance_used", [who], lambda r: email), mailer)


# ── Template 06 · receipt (M03) ────────────────────────────────────────────────────────────────────────
PAID_EVENTS = ("invoice.paid", "invoice.payment_succeeded")
PLAN_NAMES = {"basic": "Basic", "standard": "Standard", "advanced": "Advanced"}   # config/pricing.ts


def _day(ts: Any) -> date:
    return datetime.fromtimestamp(int(ts), UTC).date()


def _tax_cents(obj: dict[str, Any]) -> int:
    """Stripe moved an invoice's tax to `total_taxes` (API 2025-03-31.basil); older versions carry `tax`. Neither
    means the invoice cannot say its VAT, so it is not sent: a missing amount must never print as €0.00."""
    if isinstance(obj.get("total_taxes"), list):
        return sum(int(t["amount"]) for t in obj["total_taxes"])
    if obj.get("tax") is not None:
        return int(obj["tax"])
    raise PermanentJobError("the invoice states no tax")


def invoice_of(event: dict[str, Any], sub: dict[str, Any]) -> tuple[str, str, email_templates.Invoice]:
    """(invoice id, payer email, invoice) from a stored Stripe invoice event, without calling Stripe."""
    obj = (event.get("data") or {}).get("object") or {}
    try:
        if obj.get("currency") != "eur":
            raise PermanentJobError("the invoice is not in euro")
        lines = ((obj.get("lines") or {}).get("data") or [{}])
        period = lines[0].get("period") or {"start": obj["period_start"], "end": obj["period_end"]}
        total = int(obj["amount_paid"])
        return str(obj["id"]), str(obj["customer_email"] or ""), email_templates.Invoice(
            number=str(obj["number"]), plan=PLAN_NAMES[sub["plan"]], term={"monthly": "monthly", "annual": "annual"}[sub["term"]],
            period_start=_day(period["start"]), period_end=_day(period["end"]),
            subtotal_cents=int(obj["subtotal"]), tax_cents=_tax_cents(obj), total_cents=total,
            next_renewal=sub["current_period_end"].date() if sub.get("current_period_end") else None)
    except (KeyError, TypeError, ValueError, IndexError):
        raise PermanentJobError("the payment event is not a complete invoice") from None


def send_receipt(job: Job, ctx: JobContext, store: NotifyStore, mailer: mail.Mailer | None = None) -> None:
    """The invoice email to the payer named on the invoice, with its PDF. No PDF, no send: the job fails with a safe
    error, visible in app.jobs and Sentry, rather than sending a receipt without its invoice."""
    event_id = str(job.payload.get("payment_event_id") or "")
    if not event_id.startswith("evt_") or len(event_id) > 255:
        raise PermanentJobError("payload payment_event_id is not a Stripe event id")
    if store.job_progress(job.id).get("email") == "sent":
        return _done(ctx, "already_sent")
    pay = store.payment_for_receipt(event_id)
    if pay is None:
        raise PermanentJobError("the payment event does not exist")
    ws = _same_workspace(job, pay["workspace_id"], "the payment event")
    if pay["type"] not in PAID_EVENTS:
        raise PermanentJobError(f"payment event type {str(pay['type'])[:40]!r} is not a paid invoice")
    invoice_id, payer, invoice = invoice_of(pay["payload"], pay)
    if not payer:
        raise PermanentJobError("the invoice names no payer")
    pdf = store.invoice_pdf(event_id)
    if not pdf:
        raise PermanentJobError("the invoice PDF is not available")
    url = f"{ctx.settings.require_app_base_url()}/w/{ws}/billing/invoices/{invoice_id}"
    email = email_templates.receipt(to=payer, invoice=invoice, url=url, pdf=pdf)
    deliver(job, ctx, store, Delivery("receipt", [Recipient("recipient", payer)], lambda r: email), mailer)


TEMPLATES = {"invitation": send_invitation, "report": send_report, "rule_changed": send_rule_changed,
             "document_expiring": send_document_expiring, "allowance_used": send_allowance_used,
             "receipt": send_receipt}


@handler("notify")
def notify(job: Job, ctx: JobContext) -> None:
    template = job.payload.get("template")
    if template not in TEMPLATES:
        raise PermanentJobError(f"unknown notify template {str(template)[:40]!r}")
    if not job.workspace_id:   # every notify job names its workspace (docs/04-contracts.md), checked before any read
        raise PermanentJobError("the job names no workspace")
    TEMPLATES[template](job, ctx, ctx.store)  # type: ignore[arg-type]  # PgStore implements NotifyStore
