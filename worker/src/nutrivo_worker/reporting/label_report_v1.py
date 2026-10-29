"""Template label_report.v1: the Export - Label Report design (design/documents) as HTML for WeasyPrint.

Released templates are never edited. A document names its template in its model, and a re-render a year later must
print the same bytes, so a change to wording or layout is a new module (label_report_v2) registered in render.py,
and this one stays as it is for the documents already issued with it."""
from __future__ import annotations

from html import escape
from typing import Any

from .model import language_name

PROVENANCE = {"deterministic_rule": "Deterministic rule", "model_judgement": "Model judgement",
              "authored_definition": "Authored definition", "not_assessed": "Not assessed"}
CLASSIFICATION_PROVENANCE = {"deterministic_rule": "Rule", "model_judgement": "Judgement", "person": "Person"}
STATE = {"action": "Action needed", "not_assessed": "Not assessed", "info": "Info", "clear": "Clear",
         "blocked": "Blocked"}
TONE = {"action": "action", "not_assessed": "none", "info": "none", "clear": "clear", "blocked": "blocked"}
REGISTRATION = {"registered": ("Registered", "clear"), "not_required": ("Not required", "clear"),
                "not_registered": ("Not registered", "blocked"), "expired": ("Expired", "blocked"),
                "unknown": ("Unknown", "none")}
HEIGHT = {"x_height": "x-height", "cap_height": "cap height", "figure_height": "figure height"}
NUMBERS = ("No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve")

CSS = """
@page {
  size: A4; margin: 0.85in 0.6in 0.75in;
  @top-center { content: element(header); width: 100%; }
  @bottom-center { content: element(footer); width: 100%; }
}
:root { --ink: #101216; --rule: #dde0e6; --n200: #eef0f2; --n400: #c3c8d0; --n500: #8b9098; --n600: #6b7178;
  --n700: #42464c; --accent: #1738a8;
  --clear: #0f7a4d; --action: #9e5600; --none: #5f6570; --blocked: #b3251f;
  --clear-bg: #e6f2ec; --action-bg: #fdf0dd; --none-bg: #f1f2f4; --blocked-bg: #fbe8e7; }
body { margin: 0; color: var(--ink); font-family: 'Instrument Sans', 'Nutrivo Fallback'; font-size: 10pt; }
.mono { font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; }
h1, h2 { font-weight: 600; }
.run { display: flex; justify-content: space-between; gap: 14pt; font-family: 'IBM Plex Mono', 'Nutrivo Fallback';
  font-size: 7.5pt; letter-spacing: 0.09em; text-transform: uppercase; color: var(--n600); }
.run span { flex: 1; } .run span + span { text-align: center; } .run span:last-child { text-align: right; }
header.run { position: running(header); border-bottom: 1px solid var(--ink); padding-bottom: 5pt; }
header.run span:first-child { color: var(--accent); font-weight: 500; }
footer.run { position: running(footer); border-top: 1px solid var(--rule); padding-top: 5pt; }
.page::after { content: "Page " counter(page) " of " counter(pages); }
.kick { margin: 0; font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 8.5pt; letter-spacing: 0.13em;
  text-transform: uppercase; color: var(--accent); }
h1 { margin: 5pt 0 0; font-size: 26pt; line-height: 1.05; letter-spacing: -0.015em; }
.lead { margin: 10pt 0 0; font-size: 11pt; line-height: 1.5; }
.p { margin: 0 0 9pt; font-size: 10pt; line-height: 1.5; }
.tiles { margin-top: 16pt; display: flex; gap: 10pt; break-inside: avoid; }
.tile { flex: 1; border: 1px solid var(--rule); padding: 9pt 10pt; }
.tile .n { margin: 0; font-size: 22pt; font-weight: 600; line-height: 1; letter-spacing: -0.02em; }
.tile .l { margin: 4pt 0 0; font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 7.5pt;
  letter-spacing: 0.09em; text-transform: uppercase; }
.tile .note { margin: 4pt 0 0; font-size: 8.5pt; line-height: 1.4; color: var(--n700); }
.h2row { display: flex; align-items: baseline; gap: 9pt; border-bottom: 1px solid var(--ink); padding-bottom: 4pt;
  margin: 20pt 0 9pt; break-after: avoid; }
.h2row span { font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 8.5pt; color: var(--accent); }
.h2row h2 { margin: 0; font-size: 14pt; line-height: 1.1; }
.tbl { width: 100%; border-collapse: collapse; font-size: 8.5pt; line-height: 1.4; }
.tbl th { text-align: left; font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-weight: 400; font-size: 7.5pt;
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--n600); border-bottom: 1px solid var(--ink);
  padding: 5pt 7pt 5pt 0; vertical-align: bottom; }
.tbl td { border-bottom: 1px solid var(--rule); padding: 7pt 7pt 7pt 0; vertical-align: top; }
.tbl tr { break-inside: avoid; }
.small { font-size: 7.5pt; color: var(--n700); }
.caps { font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 7.5pt; letter-spacing: 0.07em;
  text-transform: uppercase; }
.sheet { border: 1px solid var(--ink); padding: 16pt 18pt; }
.sheet .meta { margin: 0 0 11pt; font-size: 7pt; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--n400); }
.blocks { columns: 2; column-gap: 16pt; }
.block { position: relative; border: 1px dashed; padding: 8pt 9pt; margin: 0 0 12pt 7pt; break-inside: avoid; }
.pin { display: inline-block; width: 14pt; height: 14pt; border: 1px solid; text-align: center; line-height: 14pt;
  font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 7.5pt; }
.block .pin { position: absolute; top: -7pt; left: -7pt; }
.block .lbl { margin: 0; font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 6.5pt; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--n500); }
.block .txt { margin: 3pt 0 0; font-size: 8pt; line-height: 1.35; color: var(--n700); }
.finding { border-bottom: 1px solid var(--rule); padding: 10pt 0; break-inside: avoid; }
.finding .top { display: flex; align-items: baseline; gap: 8pt; }
.finding .title { flex: 1; font-size: 11.5pt; font-weight: 600; line-height: 1.25; }
.finding .body { margin: 6pt 0 0; padding-left: 23pt; font-size: 9.5pt; line-height: 1.5; }
.facts { margin: 7pt 0 0; padding-left: 23pt; display: flex; gap: 10pt; }
.facts div { flex: 1; }
.facts .k { margin: 0; font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 6.5pt; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--n500); }
.facts .v { margin: 2pt 0 0; font-family: 'IBM Plex Mono', 'Nutrivo Fallback'; font-size: 8pt; line-height: 1.35; }
.na { border: 1px solid var(--none); background: var(--none-bg); padding: 12pt 14pt; }
.na .tbl th { border-bottom-color: var(--none); } .na .tbl td { border-bottom-color: var(--n200); }
.close { margin-top: 18pt; border-top: 1px solid var(--ink); padding-top: 9pt; display: flex; gap: 20pt;
  break-inside: avoid; }
.close p { margin: 0; }
.close .ids { width: 220pt; font-size: 7.5pt; line-height: 1.7; letter-spacing: 0.05em; color: var(--n600);
  text-align: right; word-break: break-all; }
.t-clear { color: var(--clear); } .t-action { color: var(--action); } .t-none { color: var(--none); }
.t-blocked { color: var(--blocked); }
.b-clear { border-color: var(--clear); background: var(--clear-bg); }
.b-action { border-color: var(--action); background: var(--action-bg); }
.b-none { border-color: var(--none); background: var(--none-bg); }
.b-blocked { border-color: var(--blocked); background: var(--blocked-bg); }
.tile.b-clear, .tile.b-action, .tile.b-none, .tile.b-blocked { border-color: var(--rule); border-top: 2.5pt solid; }
.tile.b-clear { border-top-color: var(--clear); } .tile.b-action { border-top-color: var(--action); }
.tile.b-none { border-top-color: var(--none); } .tile.b-blocked { border-top-color: var(--blocked); }
.block.l-action { border-color: var(--action); } .block.l-none { border-color: var(--none); }
.block.l-clear { border-color: var(--clear); }
"""


def e(value: Any) -> str:
    return escape("" if value is None else str(value))


def _count_word(n: int) -> str:
    return NUMBERS[n] if n < len(NUMBERS) else str(n)


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def _date(iso_ts: str) -> str:
    """'2026-10-29T10:44:00Z' as '29 Oct 2026, 10:44 UTC' (fixed English month names, never the locale's)."""
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    y, mo, d = iso_ts[:10].split("-")
    return f"{int(d)} {months[int(mo) - 1]} {y}, {iso_ts[11:16]} UTC"


def _short_sha(sha: str | None) -> str:
    return "unknown" if not sha else f"{sha[:4]}…{sha[-4:]}"


def _registration(state: str) -> tuple[str, str]:
    return REGISTRATION.get(state, (state, "none"))


class _View:
    """Derived values the sections share: pins, titles, counts."""

    def __init__(self, m: dict[str, Any]):
        self.m = m
        self.p, self.s = m["pinned"], m["snapshot"]
        self.c = self.p["check"]
        self.lang = self.c.get("language")
        self.language = language_name(self.lang)
        self.open = [f for f in self.p["findings"] if f["state"] == "action"]
        self.info = [f for f in self.p["findings"] if f["state"] == "info"]
        self.withheld = [f for f in self.p["findings"] if f["state"] == "not_assessed"]
        self.pins: dict[str, int] = {}
        for f in self.open + self.info:
            t = f.get("text_object_id")
            if t and t in self.s["text_objects"] and t not in self.pins:
                self.pins[t] = len(self.pins) + 1

    def title(self, f: dict[str, Any]) -> str:
        key = f.get("rule_key")
        if key and key in self.s["rule_titles"]:
            return self.s["rule_titles"][key]
        if f.get("gap_id"):
            return f"Coverage gap {f['gap_id']}"
        return f["message"]

    def basis(self, f: dict[str, Any]) -> str:
        if f.get("citation"):
            return f["citation"]
        rule = self.p["rules"].get(f.get("rule_key") or "")
        return rule["article_ref"] if rule else (f.get("gap_id") or "")

    def pin(self, f: dict[str, Any]) -> str:
        t = f.get("text_object_id")
        return str(self.pins[t]) if t in self.pins else "—"


def _header(v: _View) -> str:
    art = v.s["artwork_version"]
    return (f'<header class="run"><span>Nutrivo · label report · {e((v.lang or "—").upper())}</span>'
            f'<span>{e(v.s["product_name"])}{" · artwork v" + e(art) if art is not None else ""}</span>'
            f'<span>Ruleset {e(v.c["ruleset_version"])}</span></header>')


def _footer(v: _View) -> str:
    by = f' by {e(v.s["requested_by"])}' if v.s["requested_by"] else ""
    return (f'<footer class="run"><span>Issued {e(_date(v.m["issued_at"]))}{by}</span>'
            f'<span>Reference {e(v.m["ref"])}</span><span class="page"></span></footer>')


def _intro(v: _View) -> str:
    n = len(v.open)
    if n:
        title = f"{_count_word(n)} {_plural(n, 'finding', 'findings')} on the sheet that goes to press"
    else:
        title = "No open findings on the sheet that goes to press"
    lang = v.language
    return (f'<p class="kick">Export · label report · {e(v.s["node_name"])} · {e(lang)}</p>'
            f'<h1>{e(title)}</h1>'
            f'<p class="lead">Checked on the {e(lang)} panel as it will print, not on an English source translated '
            f'afterwards. Each finding carries the rule, its legal basis and its provenance. Anything that could not '
            f'be assessed is listed in section 05; it is not a pass.</p>')


def _tiles(v: _View) -> str:
    reg_label, reg_tone = _registration(v.s["registration_state"])
    blocking = 1 if reg_tone == "blocked" else 0
    if blocking:
        reg_note = f"Registration {reg_label.lower()}: the market is blocked whatever the label says."
    elif v.s["registration_state"] == "unknown":
        reg_note = "Registration state unknown when issued. Never read as clear."
    else:
        reg_note = f"Registration {reg_label.lower()} when issued."
    passed = len(v.c["passed_rule_keys"])
    tiles = (
        (str(len(v.open)), "Findings", "Open findings on this panel. Section 03.", "action"),
        (str(blocking), "Blocking", reg_note, "blocked"),
        (str(len(v.withheld)), "Not assessed", "Rules or domains that could not run. Section 05.", "none"),
        (str(passed), "Rules passed", "Rules that were applied to this panel and passed.", "clear"),
    )
    return '<div class="tiles">' + "".join(
        f'<div class="tile b-{tone}"><p class="n t-{tone}">{e(n)}</p><p class="l t-{tone}">{e(label)}</p>'
        f'<p class="note">{e(note)}</p></div>' for n, label, note, tone in tiles) + "</div>"


def _h2(no: str, title: str) -> str:
    return f'<div class="h2row"><span>{no}</span><h2>{e(title)}</h2></div>'


def _scope(v: _View) -> str:
    out = [_h2("01", "Scope and classification"),
           ('<p class="p">Which rulebook was applied, and why. Every finding below is scoped by these determinations; '
           'if one is wrong, challenge it here rather than each finding.</p>'),
           ('<table class="tbl"><thead><tr><th style="width: 20%">Determination</th><th style="width: 30%">Value</th>'
           '<th style="width: 32%">Basis</th><th>Provenance</th></tr></thead><tbody>')]
    rows = [("Market", f'{v.s["node_name"]} ({v.c["node_id"]})', "The check request", "Request", "none"),
            ("Language panel", v.language, "Detected on the printed panel", "Extraction", "none")]
    cl = v.p["classification"]
    if cl is None:
        rows.append(("Classification", "None recorded", "—", "Not assessed", "none"))
    else:
        prov = CLASSIFICATION_PROVENANCE.get(cl["provenance"], cl["provenance"])
        tone = "action" if cl["provenance"] == "model_judgement" else "clear"
        for k, field in (("Species", "species"), ("Life stage", "life_stage"), ("Product class", "product_class"),
                         ("Intended use", "intended_use"), ("PARNUT status", "parnut_status")):
            value = cl.get(field)
            if value is None:
                rows.append((k, "Not recorded", "—", "Not assessed", "none"))
            else:
                rows.append((k, str(value).replace("_", " ").capitalize(), cl["citation"], prov, tone))
    for k, value, basis, prov, tone in rows:
        out.append(f'<tr><td style="font-weight: 500">{e(k)}</td><td>{e(value)}</td>'
                   f'<td class="mono small">{e(basis)}</td><td class="caps t-{tone}">{e(prov)}</td></tr>')
    out.append("</tbody></table>")
    return "".join(out)


def _sheet(v: _View) -> str:
    out = [_h2("02", "The sheet, with findings pinned"),
           ('<p class="p">Text blocks extracted from the print-ready PDF. Pin numbers correspond to the findings in '
           'section 03. Only blocks a finding points to are shown.</p>'),
           (f'<div class="sheet"><p class="mono meta">Artwork v{e(v.s["artwork_version"])} · hash '
           f'{e(_short_sha(v.c["artwork_sha"]))} · {e(v.s["text_object_count"])} text blocks resolved on this '
           f'panel</p>')]
    if not v.pins:
        out.append('<p class="p" style="margin: 0">No finding on this panel points to a text block.</p>')
    else:
        out.append('<div class="blocks">')
        for tid, n in v.pins.items():
            f = next(f for f in v.open + v.info if f.get("text_object_id") == tid)
            tone = TONE[f["state"]]
            out.append(f'<div class="block l-{tone}"><span class="pin b-{tone} t-{tone}">{n}</span>'
                       f'<p class="lbl">{e(v.title(f))}</p>'
                       f'<p class="txt">{e(v.s["text_objects"][tid]["text"])}</p></div>')
        out.append("</div>")
    out.append("</div>")
    return "".join(out)


def _facts(pairs: list[tuple[str, str, str]]) -> str:
    return '<div class="facts">' + "".join(
        f'<div><p class="k">{e(k)}</p><p class="v t-{tone}">{e(val)}</p></div>' for k, val, tone in pairs) + "</div>"


def _findings(v: _View) -> str:
    out = [_h2("03", "Findings, each with its fix")]
    for f in v.open + v.info:
        tone = TONE[f["state"]]
        body = e(f["message"])
        if f.get("recommended_action"):
            body += f" {e(f['recommended_action'])}"
        facts = [("Basis", v.basis(f), "none"), ("Provenance", PROVENANCE[f["provenance"]],
                                                 "action" if f["provenance"] == "model_judgement" else "clear")]
        if f.get("measured"):
            facts.append(("Measured", f["measured"], tone))
        if f.get("required"):
            facts.append(("Required", f["required"], "none"))
        if f.get("confidence"):
            facts.append(("Confidence", f["confidence"], "none"))
        out.append(f'<div class="finding"><div class="top"><span class="pin b-{tone} t-{tone}">{e(v.pin(f))}</span>'
                   f'<span class="title">{e(v.title(f))}</span>'
                   f'<span class="caps t-{tone}">{e(STATE[f["state"]])}</span></div>'
                   f'<p class="body">{body}</p>{_facts(facts)}</div>')
    for key in v.c["passed_rule_keys"]:
        rule = v.p["rules"].get(key, {})
        out.append(f'<div class="finding"><div class="top"><span class="pin b-clear t-clear">—</span>'
                   f'<span class="title">{e(v.s["rule_titles"].get(key, key))}</span>'
                   f'<span class="caps t-clear">Clear</span></div>'
                   f'<p class="body">Applied to this panel and passed. No change needed.</p>'
                   + _facts([("Basis", rule.get("article_ref", ""), "none"), ("Rule", key, "none"),
                             ("Version", str(rule.get("version", "")), "none")]) + "</div>")
    if not v.open and not v.info and not v.c["passed_rule_keys"]:
        out.append('<p class="p">No rule was applied and passed on this panel, and none is open. See section 05.</p>')
    return "".join(out)


def _measurements(v: _View) -> str:
    out = [_h2("04", "Measurements"),
           ('<p class="p">Taken from vector outlines rather than estimated from point size. Listed for every finding '
           'that carries a measurement.</p>')]
    rows = [f for f in v.p["findings"] if f.get("measured") or f.get("required")]
    if not rows:
        out.append('<p class="p">No finding on this panel carries a measurement.</p>')
        return "".join(out)
    out.append('<table class="tbl"><thead><tr><th style="width: 30%">Element</th><th style="width: 8%">Pin</th>'
               '<th style="width: 14%">Measured</th><th style="width: 14%">Required</th>'
               '<th style="width: 16%">Basis</th><th>Result</th></tr></thead><tbody>')
    for f in rows:
        tone = TONE[f["state"]]
        basis = HEIGHT.get(f.get("height_definition") or "", "") or v.basis(f)
        out.append(f'<tr><td style="font-weight: 500">{e(v.title(f))}</td><td class="mono small">{e(v.pin(f))}</td>'
                   f'<td class="mono t-{tone}">{e(f.get("measured") or "—")}</td>'
                   f'<td class="mono">{e(f.get("required") or "—")}</td><td class="mono small">{e(basis)}</td>'
                   f'<td class="caps t-{tone}">{e(STATE[f["state"]])}</td></tr>')
    out.append("</tbody></table>")
    return "".join(out)


def _not_assessed(v: _View) -> str:
    """Always present (I01 step 3). Withheld findings are never passes."""
    out = [_h2("05", "What was not assessed"), '<div class="na">']
    keyed = {f.get("rule_key") for f in v.withheld}
    unexplained = [k for k in v.c["withheld_rule_keys"] if k not in keyed]
    n = len(v.withheld) + len(unexplained)
    if n == 0:
        out.append('<p class="p" style="margin: 0">Every rule and domain that applies to this market and panel was '
                   'assessed. Nothing was withheld.</p></div>')
        return "".join(out)
    out.append(f'<p class="p" style="margin: 0">{e(_count_word(n))} {_plural(n, "item", "items")} could not be '
               f'assessed on this artwork. {_plural(n, "It is", "They are")} not a pass. An element covered by a rule '
               f'listed here has not been checked.</p>'
               '<table class="tbl" style="margin-top: 10pt"><thead><tr><th style="width: 30%">Rule</th>'
               '<th style="width: 40%">Why it could not run</th><th>Reference</th></tr></thead><tbody>')
    for f in v.withheld:
        why = f["message"]
        gap = v.s["gaps"].get(f.get("gap_id") or "")
        if gap:
            why = f"{why} {gap['description']}" if why != gap["description"] else why
        ref = " · ".join(x for x in (f.get("reason_code"), f.get("gap_id")) if x)
        out.append(f'<tr><td><span style="display: block; font-weight: 500">{e(v.title(f))}</span>'
                   f'<span class="mono small" style="display: block; margin-top: 2pt">{e(v.basis(f))}</span></td>'
                   f'<td>{e(why)}</td><td class="mono small">{e(ref)}</td></tr>')
    for key in unexplained:
        out.append(f'<tr><td><span style="display: block; font-weight: 500">{e(v.s["rule_titles"].get(key, key))}'
                   f'</span><span class="mono small" style="display: block; margin-top: 2pt">{e(key)}</span></td>'
                   f'<td>Withheld by the check; see the check record.</td><td class="mono small">withheld</td></tr>')
    out.append("</tbody></table></div>")
    return "".join(out)


def _languages(v: _View) -> str:
    out = [_h2("06", "The other language panels"),
           (f'<p class="p">This document covers {e(v.language)} for {e(v.s["node_name"])}. Each language '
           f'panel is a separate check, because a translated particular can breach a rule even when the original '
           f'does not.</p>')]
    others = v.p["other_checks"]
    if not others:
        out.append('<p class="p">This check covered no other panel or market.</p>')
        return "".join(out)
    out.append('<table class="tbl"><thead><tr><th style="width: 16%">Language</th><th style="width: 30%">Market</th>'
               '<th style="width: 18%">Open findings</th><th>State</th></tr></thead><tbody>')
    for o in others:
        tone = TONE[o["label_state"]]
        out.append(f'<tr><td class="mono" style="color: var(--accent)">{e((o["language"] or "—").upper())}</td>'
                   f'<td>{e(v.s["node_names"].get(o["node_id"], o["node_id"]))}</td>'
                   f'<td class="mono">{e(o["open_findings"])}</td>'
                   f'<td class="caps t-{tone}">{e(STATE[o["label_state"]])}</td></tr>')
    out.append("</tbody></table>")
    return "".join(out)


def _registrations(v: _View) -> str:
    label, tone = _registration(v.s["registration_state"])
    out = [_h2("07", "Registration in this market"),
           ('<p class="p">Registration state is separate from the label: an unknown registration is never read as '
           'clear. As recorded for this market when the document was issued.</p>'),
           ('<table class="tbl"><thead><tr><th style="width: 40%">Obligation</th><th style="width: 34%">Basis</th>'
           '<th>Status</th></tr></thead><tbody>'),
           (f'<tr><td style="font-weight: 500">Registration for {e(v.s["node_name"])}</td>'
           f'<td class="mono small">Market record</td><td class="caps t-{tone}">{e(label)}</td></tr>')]
    for f in v.p["findings"]:
        if f["kind"] == "registration":
            t = TONE[f["state"]]
            out.append(f'<tr><td style="font-weight: 500">{e(v.title(f))}</td><td class="mono small">'
                       f'{e(v.basis(f))}</td><td class="caps t-{t}">{e(STATE[f["state"]])}</td></tr>')
    out.append("</tbody></table>")
    return "".join(out)


def _close(v: _View) -> str:
    return ('<div class="close"><p style="flex: 1; font-size: 8.5pt; line-height: 1.55; color: var(--n700)">'
            'This document reflects the artwork with the hash shown, checked against the ruleset shown, and nothing '
            'else. A new artwork or ruleset needs a new check. Anything in section 05 was not assessed and is not a '
            'pass.</p>'
            f'<p class="mono ids">Reference {e(v.m["ref"])}<br />Ruleset {e(v.c["ruleset_version"])}<br />'
            f'Artwork SHA-256 {e(v.c["artwork_sha"] or "unknown")}<br />Issued {e(v.m["issued_at"])}</p></div>')


def html(model: dict[str, Any], font_css: str) -> str:
    v = _View(model)
    lang = e(v.lang or "und")
    title = f"Label report {model['ref']}"
    body = "".join((_header(v), _footer(v), _intro(v), _tiles(v), _scope(v), _sheet(v), _findings(v),
                    _measurements(v), _not_assessed(v), _languages(v), _registrations(v), _close(v)))
    return (f'<!DOCTYPE html><html lang="{lang}"><head><meta charset="utf-8"><title>{e(title)}</title>'
            f'<meta name="dcterms.created" content="{e(model["issued_at"])}">'
            f'<meta name="generator" content="Nutrivo {e(model["template"])}">'
            f"<style>{font_css}{CSS}</style></head><body>{body}</body></html>")
