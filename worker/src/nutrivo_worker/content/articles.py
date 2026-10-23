"""A stored EUR-Lex XHTML body split into units: `Art. 15`, `Annex VII`. Deterministic; no model sees the whole act.

Every language version CELLAR serves marks headings with the same classes, whatever its other markup:
`p.title-article-norm` ("Article 15", "Artikel 15", "15 artikla") and `p.title-annex-1` ("ANNEX VII", "BILAG VII").
A unit runs from its heading to the next heading. Text is kept as printed; only whitespace is collapsed, one line per
block element, so a verbatim excerpt can be checked with `contains`."""
from __future__ import annotations

import re
from dataclasses import dataclass
from html.parser import HTMLParser

_BLOCKS = {"p", "div", "tr", "td", "th", "li", "br", "h1", "h2", "h3", "h4", "table"}
_SKIP = {"script", "style", "head"}
_ARTICLE = re.compile(r"(\d+\s?[a-z]?)\b")
_ROMAN = re.compile(r"\b([IVXLC]+)\b\s*$")
_ART, _ANX = "\x00art\x00", "\x00anx\x00"


@dataclass(frozen=True)
class Unit:
    label: str      # "Art. 15", "Annex VII"
    heading: str    # as printed: "Artikel 15"
    text: str       # heading line first, then one line per block


def normalise(text: str) -> str:
    """Whitespace collapsed, no-break spaces included: the comparison form for verbatim checks."""
    return " ".join(text.replace(" ", " ").replace(" ", " ").split())


class _Flatten(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP:
            self.skip += 1
            return
        if tag in _BLOCKS:
            self.parts.append("\n")
        classes = (dict(attrs).get("class") or "").split()
        if tag == "p" and "title-article-norm" in classes:
            self.parts.append(_ART)
        elif tag == "p" and "title-annex-1" in classes:
            self.parts.append(_ANX)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in _BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def _label(kind: str, heading: str) -> str | None:
    if kind == _ART:
        m = _ARTICLE.search(heading)
        return f"Art. {m.group(1).replace(' ', '')}" if m else None
    m = _ROMAN.search(heading.strip())
    return f"Annex {m.group(1)}" if m else None


def split_units(body: bytes) -> dict[str, Unit]:
    """Articles and annexes by label. A label printed twice (a consolidated text repeating a heading) keeps the
    first; text before the first heading (title, citations, recitals) belongs to no unit."""
    parser = _Flatten()
    parser.feed(body.decode("utf-8", "replace"))
    parser.close()
    flat = "".join(parser.parts)
    units: dict[str, Unit] = {}
    for chunk in re.split(f"(?={_ART}|{_ANX})", flat):
        kind = chunk[:len(_ART)]
        if kind not in (_ART, _ANX):
            continue
        lines = [normalise(line) for line in chunk[len(_ART):].split("\n")]
        lines = [line for line in lines if line]
        if not lines:
            continue
        label = _label(kind, lines[0])
        if label and label not in units:
            units[label] = Unit(label, lines[0], "\n".join(lines))
    return units


def contains(haystack: str, needle: str) -> bool:
    """Verbatim, up to whitespace: what an excerpt or a printed term must satisfy against the stored text."""
    n = normalise(needle)
    return bool(n) and n in normalise(haystack)
