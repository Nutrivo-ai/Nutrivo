"""Render a report model to PDF with WeasyPrint (I01 step 1), byte for byte reproducibly (BE-26).

What makes the bytes repeatable:
- Fonts are bundled in reporting/fonts (Instrument Sans and IBM Plex Mono, the Cobalt type, and DejaVu Sans for glyphs
  they lack, such as Greek, Cyrillic and the estimated sign; all free licences, files beside them). Nothing is taken
  from the system or the network, so a glyph never falls back to whatever a machine has installed.
- The PDF's creation date is the issue time (`dcterms.created`); it carries no modification date; its /ID is derived
  from the reference.
- fontTools stamps a subset font's `head.modified` with the current time unless SOURCE_DATE_EPOCH is set, so each
  render sets it to the issue time, under a lock because the environment is the process's.
- Fonts are always subset by fontTools, never by HarfBuzz-Subset: WeasyPrint picks HarfBuzz-Subset when the system
  has it, and the two give different bytes, so a machine with the library would print another document.
- Templates are versioned and never edited once released (label_report_v1).
WeasyPrint, pydyf and fontTools are pinned by uv.lock, and Pango and HarfBuzz (text shaping) by the worker image's
base. Upgrading any of them must re-render stored reports (`nutrivo report rerender`) and show the same hashes before
it merges."""
from __future__ import annotations

import hashlib
import logging
import os
import threading
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from . import label_report_v1

FONTS = Path(__file__).parent / "fonts"
FACES = (("Instrument Sans", 400, "InstrumentSans-Regular.ttf"), ("Instrument Sans", 500, "InstrumentSans-Medium.ttf"),
         ("Instrument Sans", 600, "InstrumentSans-SemiBold.ttf"), ("IBM Plex Mono", 400, "IBMPlexMono-Regular.ttf"),
         ("IBM Plex Mono", 500, "IBMPlexMono-Medium.ttf"), ("Nutrivo Fallback", 400, "DejaVuSans.ttf"))
FONT_FILES = frozenset(f for _, _, f in FACES)
TEMPLATES: dict[str, Callable[[dict[str, Any], str], str]] = {"label_report.v1": label_report_v1.html}

_lock = threading.Lock()


class _QuietSubsetWarning(logging.Filter):
    """The fontTools subsetter is chosen on purpose (above); WeasyPrint's per-font warning about it is noise."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "instead of HarfBuzz-Subset" not in record.getMessage()


logging.getLogger("weasyprint").addFilter(_QuietSubsetWarning())


class UnknownTemplate(ValueError):
    pass


def font_css() -> str:
    return "".join(f"@font-face {{ font-family: '{family}'; font-weight: {weight}; "
                   f"src: url('{(FONTS / file).as_uri()}'); }}" for family, weight, file in FACES)


def to_html(model: dict[str, Any]) -> str:
    template = TEMPLATES.get(model.get("template", ""))
    if template is None:
        raise UnknownTemplate(f"no template {model.get('template')!r}")
    return template(model, font_css())


def render(model: dict[str, Any]) -> bytes:
    from weasyprint import HTML
    from weasyprint.pdf import fonts as pdf_fonts
    from weasyprint.text.fonts import FontConfiguration

    issued = datetime.strptime(model["issued_at"], "%Y-%m-%dT%H:%M:%S%z")
    document = to_html(model)
    identifier = hashlib.sha256(f"nutrivo-report:{model['ref']}".encode()).hexdigest()[:32].encode("ascii")
    with _lock:
        previous = os.environ.get("SOURCE_DATE_EPOCH")
        os.environ["SOURCE_DATE_EPOCH"] = str(int(issued.timestamp()))
        pdf_fonts.harfbuzz_subset = None              # fontTools subsets, whatever the system has (see above)
        try:
            return HTML(string=document, base_url=str(FONTS)).write_pdf(
                font_config=FontConfiguration(), pdf_identifier=identifier)
        finally:
            if previous is None:
                os.environ.pop("SOURCE_DATE_EPOCH", None)
            else:
                os.environ["SOURCE_DATE_EPOCH"] = previous
