"""The emails, as designed in design/public/Nutrivo Email Templates.dc.html: one chrome (wordmark, heading, optional
panel, body, one call to action, footer with the operator line) and each template's words.

Rules from the design that apply to all six: one action per email; every email reads as plain text with the styling
stripped. Inline styles only, with the design's tokens as hex values, because mail clients drop stylesheets.
Every value is escaped; names come from customers.

The words are the design's. Where a design sentence narrates its sample (a Texas registration, "fourteen other rules")
and nothing stored can fill it truthfully, the template leaves the sentence out rather than writing a new one. Each
omission, and each phrase adapted to fit the data, is named at its template and listed for founder review on the
T-602 pull request; only Template 05's shape was settled on #59. Numbers, names and dates always come from the data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from html import escape

from .mail import Attachment, Email

INK, PAPER, RULE, PANEL = "#101216", "#ffffff", "#dde0e6", "#f4f5f7"
ACCENT, N200, N600, N800 = "#2f5eff", "#eef0f2", "#6b7178", "#26292e"
FONT = "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
OPERATOR = ("Nutrivo.ai is operated by Sunny Ventures AB, Karlbergsvägen 48, 113 37 Stockholm, Sweden. "
            "Company ID 5594297151.")


@dataclass(frozen=True)
class Layout:
    template: str
    to: str
    subject: str
    preheader: str
    heading: str
    body: list[str]
    cta: str
    cta_url: str
    footer: str = ""
    secondary: str = ""
    boundary: str = ""
    panel_title: str = ""
    panel_body: str = ""
    panel_rows: list[tuple[str, str]] = field(default_factory=list)


def render(layout: Layout, attachments: tuple[Attachment, ...] = ()) -> Email:
    return Email(to=layout.to, subject=layout.subject, html=_html(layout), text=_text(layout),
                 template=layout.template, attachments=attachments)


def _p(text: str, style: str) -> str:
    return f'<p style="{style}">{escape(text)}</p>'


def _html(e: Layout) -> str:
    body = "".join(_p(p, f"margin: 0 0 13px; font-size: 14.5px; line-height: 1.65; color: {N800}") for p in e.body)
    panel = ""
    if e.panel_title:
        rows = "".join(
            f'<tr><td style="font-size: 12.5px; color: {N800}; padding: 0 0 6px; border-bottom: 1px solid {N200}">'
            f'{escape(k)}</td><td style="font-family: monospace; font-size: 11.5px; text-align: right; padding: 0 0 6px;'
            f' border-bottom: 1px solid {N200}">{escape(v)}</td></tr>' for k, v in e.panel_rows)
        panel = (f'<div style="margin-top: 20px; border: 1px solid {INK}; border-left: 4px solid {ACCENT}; '
                 f'padding: 17px 19px">'
                 + _p(e.panel_title, "margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.3")
                 + (_p(e.panel_body, f"margin: 7px 0 0; font-size: 13.5px; line-height: 1.55; color: {N800}")
                    if e.panel_body else "")
                 + (f'<table role="presentation" width="100%" style="margin-top: 13px">{rows}</table>' if rows else "")
                 + "</div>")
    secondary = _p(e.secondary, f"margin: 13px 0 0; font-size: 13px; line-height: 1.5; color: {N600}") \
        if e.secondary else ""
    boundary = _p(e.boundary, f"margin: 26px 0 0; padding-top: 16px; border-top: 1px solid {N200}; font-size: 12.5px;"
                              f" line-height: 1.6; color: {N600}") if e.boundary else ""
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(e.subject)}</title></head>
<body style="margin: 0; padding: 24px 0; background: {PANEL}; color: {INK}; font-family: {FONT}">
<div style="display: none; max-height: 0; overflow: hidden">{escape(e.preheader)}</div>
<div style="max-width: 620px; margin: 0 auto; border: 1px solid {INK}; background: {PAPER}">
<div style="border-bottom: 1px solid {RULE}; padding: 20px 32px">
<p style="margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -0.045em; line-height: 1">nutrivo<span \
style="display: inline-block; width: 5px; height: 5px; background: {ACCENT}; margin-left: 4px"></span></p>
</div>
<div style="padding: 28px 32px 30px">
<h1 style="margin: 0; font-size: 23px; font-weight: 600; line-height: 1.2; letter-spacing: -0.03em">\
{escape(e.heading)}</h1>
{panel}<div style="margin-top: 20px">{body}</div>
<div style="margin-top: 24px"><a href="{escape(e.cta_url, quote=True)}" style="display: inline-block; \
background: {ACCENT}; color: #ffffff; padding: 13px 22px; border-radius: 3px; font-size: 14.5px; font-weight: 500; \
text-decoration: none">{escape(e.cta)}</a>{secondary}</div>
{boundary}</div>
<div style="border-top: 1px solid {RULE}; background: {PANEL}; padding: 20px 32px">
{_p(OPERATOR, f"margin: 0; font-size: 11.5px; line-height: 1.6; color: {N600}")}
{_p(e.footer, f"margin: 9px 0 0; font-size: 11.5px; line-height: 1.6; color: {N600}") if e.footer else ""}
</div></div></body></html>
"""


def _text(e: Layout) -> str:
    parts = [e.heading]
    if e.panel_title:
        parts.append("\n".join([e.panel_title, *([e.panel_body] if e.panel_body else []),
                                 *(f"- {k}: {v}" for k, v in e.panel_rows)]))
    parts += e.body
    parts.append(f"{e.cta}: {e.cta_url}")
    parts += [x for x in (e.secondary, e.boundary) if x]
    parts += ["--", OPERATOR, *([e.footer] if e.footer else [])]
    return "\n\n".join(parts) + "\n"


# ── Template 02 · You have been invited (A03) ──────────────────────────────────────────────────────────
ROLE_NAMES = {"admin": "an admin", "portfolio_manager": "a portfolio manager", "editor": "an editor",
              "viewer": "a viewer"}
EDITOR_LINE = ("You are joining as an editor, which means you can run checks and edit products in your scope. "
               "The workspace is already set up, so there is no region to pick, no recipe to enter and no artwork "
               "to upload.")
SET_UP_LINE = "The workspace is already set up, so there is no region to pick, no recipe to enter and no artwork to upload."


def first_name(display_name: str) -> str:
    return display_name.split()[0] if display_name.split() else display_name


def long_date(at: date) -> str:
    return f"{at.day} {at:%B %Y}"


def invitation(*, to: str, inviter: str, workspace: str, role: str, expires_at: datetime, url: str) -> Email:
    """The design's Template 02, less its finding panel: an invitation names no finding yet (T-105 question 3 on #27).
    The expiry is the invitation's own date, never a promise the database does not keep (question 2)."""
    first = first_name(inviter)
    role_line = EDITOR_LINE if role == "editor" else f"You are joining as {ROLE_NAMES[role]}. {SET_UP_LINE}"
    return render(Layout(
        template="invitation", to=to,
        subject=f"{inviter} has invited you to {workspace} on Nutrivo",
        preheader="Two fields and you are in.",
        heading=f"{first} has invited you to {workspace}",
        body=[role_line, "Two fields — your name and a password — and you are in."],
        cta="Create your user", cta_url=url,
        secondary=(f"The invitation expires on {long_date(expires_at)}. If it lapses, ask {first} to send another; "
                   "nothing is lost either way."),
        footer=(f"You received this because {inviter} entered your address. If you were not expecting it, ignore "
                "this email and no account is created."),
    ))


# ── Shared wording helpers ─────────────────────────────────────────────────────────────────────────────
WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty")
TENS = {30: "thirty", 40: "forty", 50: "fifty", 60: "sixty"}
ORDINALS = ("zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
            "eleventh")


def number_word(n: int) -> str:
    """The design spells small counts ("Three markets", "Two of your recipes") and keeps digits for the rest."""
    if 0 <= n <= 20:
        return WORDS[n]
    return TENS.get(n, str(n))


def ordinal(n: int) -> str:
    return ORDINALS[n] if 0 <= n < len(ORDINALS) else f"{n}th"


def counted(n: int, noun: str, plural: str | None = None) -> str:
    return f"{number_word(n)} {noun if n == 1 else (plural or noun + 's')}"


def cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def join_names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def short_date(at: date) -> str:
    """The panel rows' date: 1 NOV 2026."""
    return f"{at.day} {at:%b %Y}".upper()


def market_code(node_id: str) -> str:
    """EU-FR reads EU · FR, as everywhere in the product."""
    return node_id.replace("-", " · ")


def euro(cents: int, *, whole: bool = False) -> str:
    """€6,238.00; whole=True drops the cents of a round amount, as the design's prices do (€249)."""
    if whole and cents % 100 == 0:
        return f"€{cents // 100:,}"
    return f"€{cents / 100:,.2f}"


# ── Template 01 · A report was sent to you (I02) ───────────────────────────────────────────────────────
REPORT_BODY = "The report names every rule that was checked, the ones that were not, and where each answer came from."
REPORT_NO_ACCOUNT = ("You do not need an account to read this. The link also lets you confirm the report is current, "
                     "has not been superseded by a ruleset change, and covers what it says it covers.")
REPORT_BOUNDARY = ("This report was generated automatically by Nutrivo and attested by nobody. Nutrivo names regulatory "
                   "obligations and checks label artwork against encoded rules. It does not file registrations, pay "
                   "fees, correspond with authorities, confirm that a registration is valid, or guarantee acceptance.")


@dataclass(frozen=True)
class ReportSummary:
    """Counts over the report's pinned checks. Clear counts passed rules; Action needed and Not assessed count
    findings; Blocked counts the report's markets whose registration blocks sale (display_state)."""
    product: str
    ruleset_version: str
    checked_at: datetime
    markets: int
    panels: int
    clear: int
    action: int
    not_assessed: int
    blocked: int


def report(*, to: str, sender: str, workspace: str, summary: ReportSummary, url: str) -> Email:
    """Template 01. Left out (for founder review): the Blocked-market paragraph, which narrates the sample's Texas
    registration.
    The four counts are always all present: Not assessed is never dropped from a count."""
    s = summary
    markets = cap(counted(s.markets, "market"))
    preheader = f"{s.product}. {markets}" + (f", {number_word(s.blocked)} of them blocked on registration."
                                              if s.blocked else ".")
    lead = REPORT_BODY
    if s.not_assessed:
        lead += (f" {cap(counted(s.not_assessed, 'item'))} {'is' if s.not_assessed == 1 else 'are'} marked Not "
                 f"assessed, which means nothing was checked for {'it' if s.not_assessed == 1 else 'them'} — read "
                 f"{'it' if s.not_assessed == 1 else 'those'} before you read anything else.")
    return render(Layout(
        template="report", to=to,
        subject=f"{workspace} sent you a label compliance report",
        preheader=preheader,
        heading=f"{sender} at {workspace} sent you a report",
        panel_title=s.product,
        panel_body=(f"Checked against ruleset {s.ruleset_version} on {long_date(s.checked_at)}, for "
                    f"{counted(s.markets, 'market')} and {counted(s.panels, 'printed language panel')}."),
        panel_rows=[("Clear", str(s.clear)), ("Action needed", str(s.action)),
                    ("Not assessed", str(s.not_assessed)), ("Blocked", str(s.blocked))],
        body=[lead, REPORT_NO_ACCOUNT],
        cta="Read the report", cta_url=url,
        secondary=("The link stays valid. If the report is later superseded, the page will say so rather than showing "
                   "you something stale."),
        boundary=REPORT_BOUNDARY,
        footer=("You received this because somebody sent you a report. Nutrivo will not email you again unless they "
                "send another."),
    ))


# ── Template 03 · A rule changed (J03, O01) ────────────────────────────────────────────────────────────
EFFECTS = {"new_obligation": "New obligation", "tightened_threshold": "Tightened threshold",
           "withdrawn_authorisation": "Withdrawn authorisation", "prescribed_wording": "Prescribed wording"}
RULE_FOOTER = ("You received this because a rule changed that affects a product in your scope. Editorial changes to "
               "rules never generate an email.")


def rule_changed(*, to: str, effect_type: str, held_in: str, rule_title: str, effective_from: date | None,
                 recipes: list[str], markets: list[str], url: str, today: date) -> Email:
    """Template 03, one material change for one person, naming the recipes in their scope. Editorial diffs never
    reach this function (O01.must.1): EFFECTS has no editorial entry, so one would fail loudly here too.
    For founder review: left out, the sample's narration of prepress artwork, "re-checked already" (true only once
    J05 has run) and "nothing else in your portfolio is affected"; adapted, the heading "A rule changed in …" for
    effect types the design's subject does not cover, and the body "<recipes> use it."."""
    label = EFFECTS[effect_type]
    heading = (f"A prescribed wording changed in {held_in}" if effect_type == "prescribed_wording"
               else f"A rule changed in {held_in}")
    n = len(recipes)
    use = (f"{cap(number_word(n))} of your recipes use it." if n > 1 else "One of your recipes uses it.")
    rows = [("Recipes affected", str(n)), ("Markets affected", ", ".join(market_code(m) for m in markets))]
    if effective_from:
        rows.append(("Effective", short_date(effective_from)))
        if effective_from > today:
            rows.append(("Days to comply", str((effective_from - today).days)))
    return render(Layout(
        template="rule_changed", to=to,
        subject=f"{heading}. {use}",
        preheader=f"Effective {long_date(effective_from)}." if effective_from else use,
        heading=heading,
        panel_title=f"{label} · effective {long_date(effective_from)}" if effective_from else label,
        panel_body=rule_title,
        panel_rows=rows,
        body=[f"{join_names(recipes)} {'use' if n > 1 else 'uses'} it."],
        cta=f"See the {number_word(n)} recipes" if n > 1 else "See the recipe", cta_url=url,
        footer=RULE_FOOTER,
    ))


# ── Template 04 · A document expires (H04) ─────────────────────────────────────────────────────────────
NOTICE_DAYS = (60, 30, 7)


def document_expiring(*, to: str, document: str, supplier: str | None, expires_on: date, days: int, recipes: int,
                      registrations: int, url: str, owner: bool = True) -> Email:
    """Template 04 at 60, 30 or 7 days. For founder review: left out, the paragraphs on which rules go Not assessed
    and on the sample's Texas registration, which nothing stored links to a document yet; adapted, the heading "A
    document you rely on" (the design names the document's kind). The footer says "you own the document pack", so an
    admin who is not an owner (the 7-day notice) gets no footer until one is written."""
    cites = [counted(recipes, "recipe")] if recipes else []
    cites += [counted(registrations, "registration")] if registrations else []
    rows = [("Recipes citing it", str(recipes)), ("Registrations at risk", str(registrations)),
            ("Expires", short_date(expires_on))]
    if supplier:
        rows.append(("Supplier", supplier.upper()))
    return render(Layout(
        template="document_expiring", to=to,
        subject=f"The {document} expires in {days} days",
        preheader=f"It is evidence for {' and '.join(cites)}." if cites else "",
        heading=f"A document you rely on expires on {expires_on.day} {expires_on:%B}",
        panel_title=f"{document} · {supplier}" if supplier else document,
        panel_rows=rows,
        body=[(f"You can request a current version from {supplier} without them needing an account. They receive a "
               "link, upload the one document, and are done.")] if supplier else [],
        cta="Request the current version", cta_url=url,
        secondary="Or upload it yourself if a newer copy is already in your inbox.",
        footer=("You received this because you own the document pack for these recipes. We send this at sixty days, "
                "thirty days and seven days, then stop.") if owner else "",
    ))


# ── Template 05 · Your third free label (B02) ──────────────────────────────────────────────────────────
@dataclass(frozen=True)
class PlanPrice:
    """A paid plan as config/pricing.ts states it (tests/test_notifications.py compares the two)."""
    name: str
    recipes: int
    regions: int
    month_cents: int
    year_cents: int


PRICED_PLANS = (PlanPrice("Basic", 10, 1, 249_00, 2_490_00), PlanPrice("Standard", 30, 1, 499_00, 4_990_00))


def _region(n: int) -> str:
    return "in one region" if n == 1 else f"across {number_word(n)}"


def price_paragraph(plans: tuple[PlanPrice, ...] = PRICED_PLANS) -> str:
    basic, standard = plans
    months = {p.year_cents // p.month_cents for p in plans if p.year_cents % p.month_cents == 0}
    if len(months) != 1:
        raise ValueError("the annual term is not a whole number of months on every plan")
    return (f"{basic.name} is {euro(basic.month_cents, whole=True)} a month and covers "
            f"{number_word(basic.recipes)} recipes {_region(basic.regions)}. {standard.name} is "
            f"{euro(standard.month_cents, whole=True)} and covers {number_word(standard.recipes)} "
            f"{_region(standard.regions)}. Both exclude VAT, and an annual term is {number_word(months.pop())} months "
            "for twelve.")


def allowance_used(*, to: str, labels: int, checks: int, url: str) -> Email:
    """Template 05, count-based: free has no card and no clock (D-03, docs/08). As settled on #59 it has no panel, no
    trial footer, no "you choose which recipe stays open" and no Blocked-market paragraph; the prices come from
    config/pricing.ts. Sent once, to the workspace's creator."""
    return render(Layout(
        template="allowance_used", to=to,
        subject=f"That was your {ordinal(labels)} free label",
        preheader=f"Nothing is taken away. A {ordinal(labels + 1)} label needs a plan.",
        heading=f"You have used all {number_word(labels)} free labels",
        body=[(f"Nothing is deleted and nothing is taken away. All {number_word(labels)} labels stay, the {checks} "
               f"{'check you have run stays' if checks == 1 else 'checks you have run stay'}, every answer stays "
               f"readable, and the reports you sent stay verifiable. What stops is adding a {ordinal(labels + 1)} "
               "label."),
              price_paragraph()],
        cta="See your plan", cta_url=url,
    ))


# ── Template 06 · Your invoice (M03) ───────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Invoice:
    number: str
    plan: str                 # the plan's name, "Standard"
    term: str                 # monthly · annual
    period_start: date
    period_end: date
    subtotal_cents: int
    tax_cents: int
    total_cents: int
    next_renewal: date | None


def receipt(*, to: str, invoice: Invoice, url: str, pdf: bytes) -> Email:
    """Template 06, always with its PDF ("Sends the receipt without the PDF attached" is one of its nevers).
    Left out (for founder review): the paragraphs on carried-over recipes, itemised lines and purchase-order settings, which describe
    the sample's upgrade and settings that do not exist; the VAT row's country and rate and the payment method, which
    the stored invoice does not carry; and the footer, whose finance address and reply-to are founder items."""
    i = invoice
    billed = "annually" if i.term == "annual" else "monthly"
    rows = [("Subtotal", euro(i.subtotal_cents)), ("VAT", euro(i.tax_cents)), ("Paid", euro(i.total_cents))]
    if i.next_renewal:
        rows.append(("Next renewal", short_date(i.next_renewal)))
    return render(Layout(
        template="receipt", to=to,
        subject=f"Nutrivo invoice {i.number} · {euro(i.total_cents)} paid",
        preheader=f"{i.plan}, {i.term}. PDF attached. Nothing further is due.",
        heading=f"Thank you. {i.plan} is live on your workspace.",
        panel_title=f"Invoice {i.number} · paid in full",
        panel_body=(f"{i.plan}, billed {billed} for {long_date(i.period_start)} to {long_date(i.period_end)}. The PDF "
                    "is attached to this email and is always available in your billing settings."),
        panel_rows=rows,
        body=["Export, email, share and the public verification page are on for every recipe in this workspace."],
        cta="View invoice", cta_url=url,
        secondary="Invoices, payment method and VAT details all live in billing settings.",
    ), attachments=(Attachment(f"{i.number}.pdf", "application/pdf", pdf),))
