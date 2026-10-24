"""Extraction targets: content/candidates/eu-core.yaml, each resolved to its act and the units it names.

`candidate_source` reads like "Reg. 767/2009, Art. 15(f) with Annex VII Chapter I, as amended by Reg. 2017/2279".
The first act named is the one extracted from, and it must be listed in content/sources.yaml (EU primary law only,
D-10): anything else is refused, never guessed. Parenthesised descriptions are dropped before units are read, so an
aside such as "(with Reg. 183/2005 Art. 10)" does not add another act's article. A target names a unit; its values
always come from the extraction, never from this file."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from ..errors import SafeError

# Shapes extracted here. claim_judgement needs the claims evaluation harness (T-501) and additive_condition the
# EU Register of Feed Additives import (T-202): both are reported as skipped, never extracted half-way.
EXTRACTED_SHAPES = ("mandatory_particular", "prescribed_wording", "threshold", "character_height")
NOT_EXTRACTED = {"claim_judgement": "needs_claims_harness", "additive_condition": "needs_additive_register"}
# Copyrighted industry texts (docs/12, D-10): never a source, whatever a file says.
REFUSED_SOURCES = re.compile(r"\b(fediaf|aafco)\b", re.IGNORECASE)

_ACT = re.compile(r"\b(Reg|Dir)\.\s*(?:\((?:EC|EU|EEC)\)\s*No\s*)?(\d+)/(\d+)(?:/(?:EEC|EC|EU))?")
_UNIT = re.compile(r"(?:\bArt\.\s*|\band\s+)(\d+[a-z]?)(?=\(|\b)|\bAnnex\s+([IVXLC]+)\b")
_PARENS = re.compile(r"\([^()]*\s[^()]*\)")


class TargetError(SafeError):
    reason = "target_invalid"


@dataclass(frozen=True)
class Target:
    key: str
    shape: str
    domain: str
    candidate_source: str
    extract: str | None
    act: str | None            # the act's CELEX id, e.g. 32009R0767
    units: tuple[str, ...]     # "Art. 15", "Annex VII"

    @property
    def skip_reason(self) -> str | None:
        if self.shape in NOT_EXTRACTED:
            return NOT_EXTRACTED[self.shape]
        if self.shape not in EXTRACTED_SHAPES:
            return "shape_unknown"
        if REFUSED_SOURCES.search(self.candidate_source):
            return "source_refused"
        if not self.act:
            return "act_not_resolved"
        if not self.units:
            return "no_units_named"
        return None


def _is_year(s: str) -> bool:
    return len(s) == 2 or (len(s) == 4 and 1950 <= int(s) <= 2100)


def act_celex(kind: str, a: str, b: str) -> str:
    """Reg. 767/2009 → 32009R0767; Reg. 2017/2279 → 32017R2279; Dir. 76/211/EEC → 31976L0211; Dir. 2002/32 →
    32002L0032. Older acts print number/year, Directives and acts since 2015 year/number: whichever is the year."""
    year, number = (a, b) if _is_year(a) and not (_is_year(b) and kind == "Reg" and len(a) < 4) else (b, a)
    if len(year) == 2:
        year = ("19" if int(year) > 50 else "20") + year
    return f"3{year}{'R' if kind == 'Reg' else 'L'}{int(number):04d}"


def resolve(candidate_source: str) -> tuple[str | None, tuple[str, ...]]:
    text = candidate_source
    while _PARENS.search(text):
        text = _PARENS.sub("", text)
    m = _ACT.search(text)
    if not m:
        return None, ()
    act = act_celex(m.group(1), m.group(2), m.group(3))
    rest = text[m.end():]
    nxt = _ACT.search(rest)                  # units belong to the first act only
    rest = rest[:nxt.start()] if nxt else rest
    units: list[str] = []
    for u in _UNIT.finditer(rest):
        label = f"Art. {u.group(1)}" if u.group(1) else f"Annex {u.group(2)}"
        if label not in units:
            units.append(label)
    return act, tuple(units)


def load_targets(path: Path, listed_acts: set[str]) -> list[Target]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = []
    for t in data.get("targets") or []:
        if not t.get("key") or not t.get("shape") or not t.get("candidate_source"):
            raise TargetError(f"target {str(t.get('key'))[:60]!r} lacks key, shape or candidate_source")
        act, units = resolve(str(t["candidate_source"]))
        out.append(Target(str(t["key"]), str(t["shape"]), str(t.get("domain") or ""), str(t["candidate_source"]),
                          t.get("extract"), act if act in listed_acts else None, units))
    return out
