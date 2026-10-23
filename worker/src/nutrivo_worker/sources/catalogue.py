"""The Catalogue of feed materials (Reg. (EU) No 68/2013 as amended) → ref.feed_materials (T-202, docs/12).

The latest consolidated text dated on or before today is fetched in every launch language through the T-201 path
(CELLAR, language check, stored byte for byte with sha256). Annex Part C is read from each language version: an
entry is a table row of four cells whose first cell is a catalogue number (`1.1.1`; some versions print `1.1.1.`).
`names` takes each language's name from that language's own text, never from another language; a language that
has no entry for a number is left out of `names` and reported. Footnote references are dropped by their markup
(an `<a href="#…">` anchor, or a superscript printed alone in parentheses, as in `expeller (<sup>5</sup>)`), and so
are the consolidation markers EUR-Lex adds around amended text (`►M1`, `►C3`, `◄`); nothing else is changed. `description` and `compulsory_declarations` are taken from the
English text as printed (one paragraph per declaration line); `source_id` is the English text's ref.sources row.

Every language must be fetched and read before anything is written: a partial catalogue is never imported."""
from __future__ import annotations

import re
from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from typing import Any, Protocol

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..logs import get_logger, kv
from . import eurlex
from .http import PoliteClient, SourceError
from .imports import Outcome, failed
from .store import Meta, SourceStore

log = get_logger(__name__)

ACT = "32013R0068"
REGISTER = "feed-materials"
BASE_LANGUAGE = "en"
_NUMBER = re.compile(r"^(\d+\.\d+\.\d+)\.?$")
_BLOCKS = frozenset({"p", "div", "li", "br", "tr", "table"})
_SUP = "\x00"                                       # brackets superscript text while a cell is read
_MARKERS = re.compile(r"►[A-Z]\d*|◄")                # consolidation markers, not text of the act
_SUP_REF = re.compile(r"\s*\(\s*\x00[^\x00]*\x00\s*\)")   # a superscript alone in parentheses: a footnote reference


@dataclass(frozen=True)
class CatalogueEntry:
    number: str
    name: str
    description: str | None
    declarations: list[str]


@dataclass(frozen=True)
class MaterialRow:
    number: str
    names: dict[str, str]
    description: str | None
    compulsory_declarations: list[str]
    languages_missing: list[str] = field(default_factory=list)


class _Rows(HTMLParser):
    """Every table row as a list of cells, each cell a list of its paragraphs (whitespace collapsed). Text inside a
    footnote reference anchor is dropped. Rows of nested tables come out as rows of their own."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[list[str]]] = []
        self._stack: list[dict[str, Any]] = []      # one frame per open table: current row and cell
        self._anchors: list[bool] = []              # per open anchor: is its text a footnote reference
        self._sup: list[bool] = []                  # per open span: is it a superscript

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "a":
            self._anchors.append(bool(self._anchors and self._anchors[-1])
                                 or (attr.get("href") or "").startswith("#"))
        elif tag == "span":
            self._sup.append("superscript" in (attr.get("class") or "").split())
            if self._sup[-1]:
                self.handle_data(_SUP)
        if tag == "table":
            self._stack.append({"row": None, "cell": None})
        if not self._stack:
            return
        frame = self._stack[-1]
        if tag == "tr":
            frame["row"], frame["cell"] = [], None
        elif tag in ("td", "th") and frame["row"] is not None:
            frame["cell"] = [""]
            frame["row"].append(frame["cell"])
        elif tag in _BLOCKS and tag != "table" and frame["cell"] is not None:
            frame["cell"].append("")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br" and self._stack and self._stack[-1].get("cell") is not None:
            self._stack[-1]["cell"].append("")

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchors:
            self._anchors.pop()
        elif tag == "span" and self._sup and self._sup.pop():
            self.handle_data(_SUP)
        if not self._stack:
            return
        frame = self._stack[-1]
        if tag == "table":
            self._stack.pop()
        elif tag == "tr" and frame["row"] is not None:
            cells = [[p for p in (_clean(t) for t in c) if p] for c in frame["row"]]
            self.rows.append(cells)
            frame["row"], frame["cell"] = None, None
        elif tag in ("td", "th"):
            frame["cell"] = None
        elif tag in _BLOCKS and frame.get("cell") is not None:
            frame["cell"].append("")

    def handle_data(self, data: str) -> None:
        if (self._anchors and self._anchors[-1]) or not self._stack:
            return
        cell = self._stack[-1].get("cell")
        if cell is not None:
            cell[-1] += data


def _clean(text: str) -> str:
    return " ".join(_MARKERS.sub("", _SUP_REF.sub("", text)).replace(_SUP, "").split())


def parse_part_c(body: bytes, language: str) -> dict[str, CatalogueEntry]:
    parser = _Rows()
    parser.feed(body.decode("utf-8"))
    parser.close()
    out: dict[str, CatalogueEntry] = {}
    for cells in parser.rows:
        if len(cells) != 4 or len(cells[0]) != 1:
            continue
        m = _NUMBER.match(cells[0][0])
        if not m:
            continue
        number = m.group(1)
        if number in out:
            raise SourceError(f"catalogue number {number} appears twice in the {language} text", "unexpected_shape")
        name = " ".join(cells[1])
        if not name:
            raise SourceError(f"catalogue number {number} has no name in the {language} text", "unexpected_shape")
        out[number] = CatalogueEntry(number, name, "\n".join(cells[2]) or None, cells[3])
    if not out:
        raise SourceError(f"no catalogue entries found in the {language} text", "unexpected_shape")
    return out


def _key(number: str) -> tuple[tuple[int, str], ...]:
    return tuple((int(p), "") if p.isdigit() else (0, p) for p in number.split("."))


def plan(by_language: dict[str, dict[str, CatalogueEntry]]) -> list[MaterialRow]:
    """One row per catalogue number found in any language; names only where that language has the entry."""
    languages = list(by_language)
    numbers = sorted({n for entries in by_language.values() for n in entries}, key=_key)
    rows = []
    for n in numbers:
        base = by_language.get(BASE_LANGUAGE, {}).get(n)
        rows.append(MaterialRow(
            number=n,
            names={lang: by_language[lang][n].name for lang in languages if n in by_language[lang]},
            description=base.description if base else None,
            compulsory_declarations=base.declarations if base else [],
            languages_missing=[lang for lang in languages if n not in by_language[lang]]))
    return rows


class MaterialTable(Protocol):
    def upsert(self, row: MaterialRow, source_id: str | None) -> bool: ...
    def numbers(self) -> set[str]: ...


class PgMaterialTable:
    def __init__(self, conn):  # type: ignore[no-untyped-def]
        self.conn = conn

    def upsert(self, row: MaterialRow, source_id: str | None) -> bool:
        with self.conn.cursor(row_factory=dict_row) as cur:
            got = cur.execute(
                """insert into ref.feed_materials as t (number, names, description, compulsory_declarations,
                                                        source_id)
                   values (%s, %s, %s, %s, %s)
                   on conflict (number) do update set names = excluded.names, description = excluded.description,
                       compulsory_declarations = excluded.compulsory_declarations, source_id = excluded.source_id
                   where (t.names, t.description, t.compulsory_declarations, t.source_id)
                         is distinct from (excluded.names, excluded.description, excluded.compulsory_declarations,
                                           excluded.source_id)
                   returning number""",
                (row.number, Jsonb(row.names), row.description, row.compulsory_declarations, source_id),
            ).fetchone()
        return got is not None

    def numbers(self) -> set[str]:
        return {r["number"] for r in self.conn.execute("select number from ref.feed_materials").fetchall()}


def run(client: PoliteClient, store: SourceStore | None, table: MaterialTable | None, languages: list[str], *,
        title: str, licence: str = "eu_reuse", today: date | None = None,
        transaction: Callable[[], AbstractContextManager[Any]] = nullcontext,
        now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> list[Outcome]:
    """Fetch, store and import. With `store` None it is a dry run: fetched, hashed and planned, nothing written."""
    today = today or now().date()
    try:
        current, _later = eurlex.pick(eurlex.consolidations(client, ACT), today)
    except Exception as exc:  # noqa: BLE001
        return [failed("pull", ACT, exc, register=REGISTER)]
    celex = current.celex if current else ACT
    full_title = f"{title} · consolidated text {current.consolidated_on.isoformat()}" if current else title

    outcomes: list[Outcome] = []
    docs: dict[str, eurlex.Document] = {}
    parsed: dict[str, dict[str, CatalogueEntry]] = {}
    for lang in languages:
        try:
            docs[lang] = eurlex.fetch(client, celex, lang)
            parsed[lang] = parse_part_c(docs[lang].body, lang)
        except Exception as exc:  # noqa: BLE001  visible; nothing is written unless every language is read
            outcomes.append(failed("pull", celex, exc, register=REGISTER, language=lang))
    if len(parsed) != len(languages) or BASE_LANGUAGE not in parsed:
        return outcomes
    rows = plan(parsed)

    if store is None or table is None:
        outcomes += [Outcome("pull", celex, "fetched", language=lang, sha256=d.sha256, url=d.url)
                     for lang, d in docs.items()]
        return outcomes + [Outcome("material", r.number, "importable", id=r.number,
                                   reason="language_missing" if r.languages_missing else None,
                                   languages_missing=r.languages_missing) for r in rows]

    pull_outcomes, written = [], []
    try:
        with transaction():
            source_ids = {}
            for lang, d in docs.items():
                status, source_ids[lang] = store.save(d, Meta(full_title, licence), now())
                pull_outcomes.append(Outcome("pull", celex, status, language=lang, sha256=d.sha256, url=d.url,
                                             source_id=source_ids[lang]))
            for r in rows:
                changed = table.upsert(r, source_ids[BASE_LANGUAGE])
                written.append(Outcome("material", r.number, "imported" if changed else "unchanged", id=r.number,
                                       source_id=source_ids[BASE_LANGUAGE],
                                       reason="language_missing" if r.languages_missing else None,
                                       languages_missing=r.languages_missing))
            stale = [Outcome("material", n, "stale", id=n, reason="not_in_catalogue",
                             note="left in place: removing a row is a founder decision (issue #32)")
                     for n in sorted(table.numbers() - {r.number for r in rows}, key=_key)]
    except Exception as exc:  # noqa: BLE001  the transaction rolled back: nothing of this import is written
        return outcomes + [failed("pull", celex, exc, register=REGISTER)]
    if stale:
        log.warning("catalogue rows not in this text", extra=kv(register=REGISTER, stale=len(stale)))
    return outcomes + pull_outcomes + written + stale
