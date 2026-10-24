"""EUR-Lex documents through CELLAR, the Publications Office repository EUR-Lex is published from (docs/14).

- Consolidated versions of an act are listed by the CELLAR SPARQL endpoint: CELEX ids `0YYYYXNNNN-YYYYMMDD`, the
  suffix being the consolidation date. The latest one dated on or before the run date is fetched; later ones (texts
  consolidated ahead of their application date) are reported, not fetched.
- A language version is `https://publications.europa.eu/resource/celex/{celex}` with `Accept: application/xhtml+xml`
  and `Accept-Language: <ISO 639-2>`, redirected (303) to its manifestation. The body is kept byte for byte.
- Every body is checked to be in the language asked for before it is stored; a mismatch fails, never stores."""
from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from urllib.parse import urlencode

from .http import PoliteClient, SourceError

CELLAR = "https://publications.europa.eu"
SPARQL_ENDPOINT = f"{CELLAR}/webapi/rdf/sparql"
XHTML = "application/xhtml+xml"
# The launch languages (D-01) and their ISO 639-2 codes, which CELLAR negotiates on.
LANGUAGES = {"en": "eng", "sv": "swe", "da": "dan", "fi": "fin", "de": "deu"}

_ACT = re.compile(r"^[1-9]\d{4}[A-Z]{1,2}\d{4}$")                 # 32009R0767, 31976L0211
_CONSOLIDATED = re.compile(r"^0(\d{4}[A-Z]{1,2}\d{4})-(\d{4})(\d{2})(\d{2})$")   # 02009R0767-20181226


@dataclass(frozen=True)
class Consolidation:
    celex: str
    consolidated_on: date


@dataclass(frozen=True)
class Document:
    celex: str                      # the consolidated CELEX id, or the act's own when it has no consolidated version
    consolidated_on: date | None
    language: str                   # ISO 639-1, as content/sources.yaml and ref.sources use
    url: str                        # the manifestation the body came from
    content_type: str
    body: bytes
    sha256: str


def check_act(celex: str) -> str:
    if not _ACT.match(celex):
        raise SourceError(f"not an act CELEX id: {celex[:40]!r}", "bad_celex")
    return celex


def consolidation_date(celex: str | None) -> date | None:
    """The consolidation date a consolidated CELEX id carries (ref.sources.celex), or None for an act's own id."""
    m = _CONSOLIDATED.match(celex or "")
    return date(int(m.group(2)), int(m.group(3)), int(m.group(4))) if m else None


def consolidations(client: PoliteClient, act: str) -> list[Consolidation]:
    """Every consolidated version CELLAR knows for `act`, oldest first."""
    prefix = "0" + check_act(act)[1:] + "-"
    query = ("PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n"
             "SELECT DISTINCT ?celex WHERE { ?work cdm:resource_legal_id_celex ?celex . "
             f'FILTER(STRSTARTS(STR(?celex), "{prefix}")) }} ORDER BY ?celex')
    resp = client.get(f"{SPARQL_ENDPOINT}?{urlencode({'query': query})}",
                      {"Accept": "application/sparql-results+json"})
    if resp.status != 200:
        raise SourceError(f"SPARQL HTTP {resp.status} for {act}", f"http_{resp.status}")
    try:
        bindings = json.loads(resp.body)["results"]["bindings"]
        ids = {b["celex"]["value"] for b in bindings}
    except (ValueError, KeyError, TypeError) as exc:
        raise SourceError(f"SPARQL answer for {act} is not a result set", "bad_sparql_answer") from exc
    out = []
    for celex in sorted(ids):
        on = consolidation_date(celex)
        if on is not None and celex.startswith(prefix):
            out.append(Consolidation(celex, on))
    return out


def pick(versions: list[Consolidation], today: date) -> tuple[Consolidation | None, list[Consolidation]]:
    """The latest version in force by `today`, and the ones dated after it."""
    current = [v for v in versions if v.consolidated_on <= today]
    return (current[-1] if current else None), [v for v in versions if v.consolidated_on > today]


def fetch(client: PoliteClient, celex: str, language: str) -> Document:
    if language not in LANGUAGES:
        raise SourceError(f"language {language!r} is not a launch language", "bad_language")
    resp = client.get(f"{CELLAR}/resource/celex/{celex}", {"Accept": XHTML, "Accept-Language": LANGUAGES[language]})
    if resp.status in (404, 406):
        raise SourceError(f"{celex} has no {language} version in CELLAR (HTTP {resp.status})", "not_available")
    if resp.status != 200:
        raise SourceError(f"HTTP {resp.status} for {celex} {language}", f"http_{resp.status}")
    content_type = resp.header("content-type") or ""
    if not content_type.startswith((XHTML, "text/html")):
        raise SourceError(f"{celex} {language} came as {content_type[:60]!r}", "unexpected_content_type")
    if not resp.body.strip():
        raise SourceError(f"{celex} {language} came empty", "empty_body")
    found = detect_language(resp.body)
    if found != language:
        raise SourceError(f"{celex} asked in {language}, body reads as {found or 'unknown'}", "language_mismatch")
    return Document(celex=celex, consolidated_on=consolidation_date(celex), language=language, url=resp.url,
                    content_type=content_type, body=resp.body, sha256=hashlib.sha256(resp.body).hexdigest())


# ── language check ─────────────────────────────────────────────────────────────────────────────────
_TAGS = re.compile(rb"<(script|style)\b.*?</\1>|<[^>]+>", re.DOTALL | re.IGNORECASE)
_EU = ("BULGARIAN", "CROATIAN", "CZECH", "DANISH", "DUTCH", "ENGLISH", "ESTONIAN", "FINNISH", "FRENCH", "GERMAN",
       "GREEK", "HUNGARIAN", "IRISH", "ITALIAN", "LATVIAN", "LITHUANIAN", "POLISH", "PORTUGUESE", "ROMANIAN",
       "SLOVAK", "SLOVENE", "SPANISH", "SWEDISH", "BOKMAL")    # Maltese is not in lingua; Bokmål guards Danish


@lru_cache(maxsize=1)
def _detector():  # type: ignore[no-untyped-def]
    from lingua import Language, LanguageDetectorBuilder

    return LanguageDetectorBuilder.from_languages(*(getattr(Language, n) for n in _EU)).build()


def detect_language(body: bytes) -> str | None:
    """ISO 639-1 of the body's running text, judged on a slice past the title block; None when undecided."""
    text = html.unescape(_TAGS.sub(b" ", body).decode("utf-8", "replace"))
    text = " ".join(text.split())
    sample = text[len(text) // 4: len(text) // 4 + 20_000] if len(text) > 4_000 else text
    lang = _detector().detect_language_of(sample) if sample else None
    return lang.iso_code_639_1.name.lower() if lang else None
