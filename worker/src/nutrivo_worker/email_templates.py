"""The emails, as designed in design/public/Nutrivo Email Templates.dc.html: one chrome (wordmark, heading, optional
panel, body, one call to action, footer with the operator line) and each template's words.

Rules from the design that apply to all six: one action per email; every email reads as plain text with the styling
stripped. Inline styles only, with the design's tokens as hex values, because mail clients drop stylesheets.
Every value is escaped; names come from customers."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from html import escape

from .mail import Email

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
    footer: str
    secondary: str = ""
    boundary: str = ""
    panel_title: str = ""
    panel_body: str = ""
    panel_rows: list[tuple[str, str]] = field(default_factory=list)


def render(layout: Layout) -> Email:
    return Email(to=layout.to, subject=layout.subject, html=_html(layout), text=_text(layout),
                 template=layout.template)


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
                 + _p(e.panel_body, f"margin: 7px 0 0; font-size: 13.5px; line-height: 1.55; color: {N800}")
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
{_p(e.footer, f"margin: 9px 0 0; font-size: 11.5px; line-height: 1.6; color: {N600}")}
</div></div></body></html>
"""


def _text(e: Layout) -> str:
    parts = [e.heading]
    if e.panel_title:
        parts.append("\n".join([e.panel_title, e.panel_body, *(f"- {k}: {v}" for k, v in e.panel_rows)]))
    parts += e.body
    parts.append(f"{e.cta}: {e.cta_url}")
    parts += [x for x in (e.secondary, e.boundary) if x]
    parts += ["--", OPERATOR, e.footer]
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


def long_date(at: datetime) -> str:
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
