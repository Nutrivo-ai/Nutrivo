"""extract_artwork: pypdfium2 for characters, tight glyph boxes, origins and page objects; fontTools for OS/2 heights
(D-15, docs/06). Per page: characters become text lines, everything printed is clustered into panels, each panel gets
its dominant signal, its language and, when extracted, both heights on every text object (BE-16, BE-17). A failure is
a named panel status, never an exception for the file (BE-18). Logs and Sentry see ids and counts, never label text."""
from __future__ import annotations

import ctypes
import hashlib
import math
import statistics
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
import sentry_sdk

from ..logs import get_logger, kv
from . import language
from .fonts import FLAT_CAPS, FLAT_X, FontMetrics, font_metrics
from .layout import Item, Region, cluster, dominant_signal
from .types import PT_TO_MM, TOLERANCE_MM, ExtractionResult, Panel, TextObject

log = get_logger(__name__)

ENGINE = "pypdfium2+fonttools"
EXTRACTOR_VERSION = "1"                 # bump when the algorithm changes what it returns for the same file
INVISIBLE = 3                           # text render mode 3: invisible (an OCR layer), not printed


def engine_version() -> str:
    def v(dist: str) -> str:
        try:
            return metadata.version(dist)
        except metadata.PackageNotFoundError:
            return "?"
    return (f"{EXTRACTOR_VERSION} (pypdfium2 {pdfium.version.PYPDFIUM_INFO}, PDFium {pdfium.version.PDFIUM_INFO}, "
            f"fontTools {v('fonttools')}, lingua {v('lingua-language-detector')})")


def idempotency_key(file_sha256: str) -> str:
    """The same file through the same engine gives the same result: extraction_runs.idempotency_key."""
    return f"extract:{file_sha256}:{hashlib.sha256(engine_version().encode()).hexdigest()[:12]}"


@dataclass
class Char:
    ch: str
    loose: tuple[float, float, float, float]   # l, b, r, t in points, PDF space
    top_mm: float                       # tight glyph top above the baseline, perpendicular to it, mm
    font_key: int
    size_pt: float                      # effective size, perpendicular to the baseline
    angle: float                        # baseline direction, degrees
    across: float                       # the origin's offset perpendicular to the baseline, points
    start: float                        # the loose box's extent along the baseline, points
    end: float


@dataclass
class Line:
    chars: list[Char] = field(default_factory=list)
    text: str = ""

    @property
    def first(self) -> Char:
        return self.chars[0]


def _r(v: float) -> float:
    return round(v, 3)


def _mm_box(l: float, b: float, r: float, t: float, page_h: float) -> list[float]:
    return [l * PT_TO_MM, (page_h - t) * PT_TO_MM, r * PT_TO_MM, (page_h - b) * PT_TO_MM]


def _chars(tp, fonts: dict[int, FontMetrics]) -> list[Char]:
    raw = tp.raw
    ox, oy = ctypes.c_double(), ctypes.c_double()
    l, r, b, t = ctypes.c_double(), ctypes.c_double(), ctypes.c_double(), ctypes.c_double()
    size, m = ctypes.c_float(), pdfium_c.FS_MATRIX()
    seen_obj: dict[int, tuple[int, float] | None] = {}
    out = []
    for i in range(tp.count_chars()):
        if pdfium_c.FPDFText_IsGenerated(raw, i) == 1:
            continue
        obj = pdfium_c.FPDFText_GetTextObject(raw, i)
        key = ctypes.cast(obj, ctypes.c_void_p).value or 0
        if key not in seen_obj:
            if not obj or pdfium_c.FPDFTextObj_GetTextRenderMode(obj) == INVISIBLE:
                seen_obj[key] = None
            else:
                font = pdfium_c.FPDFTextObj_GetFont(obj)
                font_key = ctypes.cast(font, ctypes.c_void_p).value or 0
                if font_key not in fonts:
                    fonts[font_key] = font_metrics(font)
                pdfium_c.FPDFTextObj_GetFontSize(obj, ctypes.byref(size))
                seen_obj[key] = (font_key, size.value)
        info = seen_obj[key]
        if info is None:
            continue
        ch = chr(pdfium_c.FPDFText_GetUnicode(raw, i))
        if ch in "\r\n\x00":
            continue
        pdfium_c.FPDFText_GetMatrix(raw, i, ctypes.byref(m))      # text matrix times CTM, without the font size
        hyp = math.hypot(m.a, m.b)
        if not hyp:
            continue
        ux, uy = m.a / hyp, m.b / hyp                              # along the baseline
        nx, ny = -uy, ux                                           # perpendicular: up for upright text
        eff = info[1] * abs(m.a * m.d - m.b * m.c) / hyp           # the scale perpendicular to the baseline
        pdfium_c.FPDFText_GetCharOrigin(raw, i, ctypes.byref(ox), ctypes.byref(oy))
        pdfium_c.FPDFText_GetCharBox(raw, i, ctypes.byref(l), ctypes.byref(r), ctypes.byref(b), ctypes.byref(t))
        loose = tp.get_charbox(i, loose=True)
        top = max((x - ox.value) * nx + (y - oy.value) * ny for x in (l.value, r.value) for y in (b.value, t.value))
        along = [x * ux + y * uy for x in (loose[0], loose[2]) for y in (loose[1], loose[3])]
        out.append(Char(ch, loose, top * PT_TO_MM, info[0], eff, math.degrees(math.atan2(uy, ux)),
                        ox.value * nx + oy.value * ny, min(along), max(along)))
    return out


def _lines(chars: list[Char]) -> list[Line]:
    """Characters in content order become lines along their own baseline, at any rotation: same font, size and
    direction, same baseline, no jump back or across a gap."""
    lines: list[Line] = []
    cur: Line | None = None
    right = 0.0
    pending_space = False
    for c in chars:
        if c.ch.isspace():
            pending_space = cur is not None
            continue
        if cur is not None:
            f = cur.first
            same = (c.font_key == f.font_key and abs(c.size_pt - f.size_pt) <= 0.01 * f.size_pt
                    and abs((c.angle - f.angle + 180) % 360 - 180) <= 1.0
                    and abs(c.across - f.across) <= 0.2 * f.size_pt
                    and right - 0.5 * f.size_pt <= c.start <= right + 1.0 * f.size_pt)
            if same:
                if pending_space or c.start - right > 0.15 * f.size_pt:
                    cur.text += " "
                cur.chars.append(c)
                cur.text += c.ch
                right = max(right, c.end)
                pending_space = False
                continue
        cur = Line([c], c.ch)
        lines.append(cur)
        right = c.end
        pending_space = False
    return lines


def _page_items(page, lines: list[Line], page_h: float) -> list[Item]:
    items = []
    for ln in lines:
        boxes = [c.loose for c in ln.chars]
        bb = _mm_box(min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes),
                     max(x[3] for x in boxes), page_h)
        items.append(Item("text", bb, ln))
    fill, stroke = ctypes.c_int(), ctypes.c_int()
    for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_PATH, pdfium_c.FPDF_PAGEOBJ_IMAGE), max_depth=8):
        if obj.type == pdfium_c.FPDF_PAGEOBJ_PATH:
            pdfium_c.FPDFPath_GetDrawMode(obj.raw, ctypes.byref(fill), ctypes.byref(stroke))
            if not fill.value and not stroke.value:
                continue                # a clipping or invisible path prints nothing
        l, b, r, t = obj.get_bounds()
        if r - l <= 0 and t - b <= 0:
            continue
        items.append(Item("path" if obj.type == pdfium_c.FPDF_PAGEOBJ_PATH else "image", _mm_box(l, b, r, t, page_h)))
    return items


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _text_object(line: Line, bbox: list[float], fm: FontMetrics, box_em: dict[str, float | None]
                 ) -> TextObject | None:
    """Both heights from the font programme, cross-checked against this line's tight glyph boxes. Without a usable
    programme value, the font's own printed flat glyphs elsewhere on the page (box_em); without either, None."""
    size = line.first.size_pt
    to_mm = size * PT_TO_MM
    cap_em, x_em, source = fm.cap_em, fm.x_em, fm.source or "outline"
    if cap_em is None or x_em is None:
        cap_em, x_em, source = cap_em or box_em["cap"], x_em or box_em["x"], "glyph_box"
    if cap_em is None or x_em is None:
        return None
    cap_mm, x_mm = cap_em * to_mm, x_em * to_mm
    box_cap = _median([c.top_mm for c in line.chars if c.ch in FLAT_CAPS])
    box_x = _median([c.top_mm for c in line.chars if c.ch in FLAT_X])
    checks = [abs(a - b) <= TOLERANCE_MM for a, b in ((box_cap, cap_mm), (box_x, x_mm)) if a is not None]
    confidence = 0.8 if not checks or source == "glyph_box" else (1.0 if all(checks) else 0.5)
    return TextObject(text=line.text, bbox_mm=[_r(v) for v in bbox], font_name=fm.name, font_size_pt=_r(size),
                      x_height_mm=_r(x_mm), cap_height_mm=_r(cap_mm), confidence=confidence, height_source=source)


def _panel(region: Region, index: int, page_no: int, fonts: dict[int, FontMetrics],
           box_em: dict[int, dict[str, float | None]]) -> Panel:
    lines = [(i.ref, i.bbox) for i in region.items if i.kind == "text"]
    chars = sum(len(ln.chars) for ln, _ in lines)
    signal = dominant_signal(chars, sum(i.kind == "path" for i in region.items),
                             sum(i.kind == "image" for i in region.items))
    text = "\n".join(ln.text for ln, _ in lines)
    lang, conf = language.detect(text) if signal == "extracted" else ("und", None)
    bbox = [_r(v) for v in region.bbox]
    if signal != "extracted":
        return Panel(index, page_no, bbox, lang, conf, "not_assessable", signal)
    objects = []
    for ln, bb in lines:
        fm = fonts[ln.first.font_key]
        obj = _text_object(ln, bb, fm, box_em[ln.first.font_key]) if fm.embedded else None
        if obj is None:                 # heights cannot be measured from this font: withhold the panel
            return Panel(index, page_no, bbox, lang, conf, "not_assessable", "missing_font")
        objects.append(obj)
    return Panel(index, page_no, bbox, lang, conf, "extracted", None, objects)


def _flat_glyph_em(lines: list[Line]) -> dict[int, dict[str, float | None]]:
    per: dict[int, dict[str, list[float]]] = {}
    for ln in lines:
        for c in ln.chars:
            d = per.setdefault(c.font_key, {"cap": [], "x": []})
            if c.ch in FLAT_CAPS:
                d["cap"].append(c.top_mm / (c.size_pt * PT_TO_MM))
            elif c.ch in FLAT_X:
                d["x"].append(c.top_mm / (c.size_pt * PT_TO_MM))
    return {k: {"cap": _median(v["cap"]), "x": _median(v["x"])} for k, v in per.items()}


def _page_size(doc, page_no: int) -> tuple[float, float]:
    """The page size in mm without loading the page; (0, 0) when even that cannot be read (no geometry, no guess)."""
    size = pdfium_c.FS_SIZEF()
    if not pdfium_c.FPDF_GetPageSizeByIndexF(doc.raw, page_no, ctypes.byref(size)):
        return (0.0, 0.0)
    return (_r(size.width * PT_TO_MM), _r(size.height * PT_TO_MM))


def _page_panels(doc, page_no: int, start: int, fonts: dict[int, FontMetrics]) -> tuple[tuple[float, float], list[Panel]]:
    size_mm = _page_size(doc, page_no)
    try:
        page = doc[page_no]
        w, h = page.get_size()
        size_mm = (_r(w * PT_TO_MM), _r(h * PT_TO_MM))
        trim = _mm_box(*page.get_trimbox(), h)        # falls back to the CropBox; crop marks lie outside it
        tp = page.get_textpage()
        lines = _lines(_chars(tp, fonts))
        regions = cluster(_page_items(page, lines, h), w * PT_TO_MM, h * PT_TO_MM, trim)
        box_em = _flat_glyph_em(lines)
        return size_mm, [_panel(r, start + n, page_no, fonts, box_em) for n, r in enumerate(regions)]
    except Exception as exc:            # one page that cannot be loaded or parsed is one named failure for that page
        sentry_sdk.capture_exception(exc)
        log.warning("extraction page unreadable", exc_info=exc, extra=kv(page=page_no))
        return size_mm, [Panel(start, page_no, [0.0, 0.0, size_mm[0], size_mm[1]], "und", None, "not_assessable",
                               "unreadable")]


def extract_artwork(path: str | Path) -> ExtractionResult:
    data = Path(path).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    result = ExtractionResult(sha, idempotency_key(sha), ENGINE, engine_version(), [], [])
    with sentry_sdk.start_span(op="extraction", name="extract_artwork") as span:
        span.set_data("file_sha256", sha)
        try:
            doc = pdfium.PdfDocument(data)
        except pdfium.PdfiumError:      # corrupt, encrypted or not a PDF: nothing to place, so no geometry
            result.panels.append(Panel(0, 0, [0.0, 0.0, 0.0, 0.0], "und", None, "not_assessable", "unreadable"))
        else:
            try:
                fonts: dict[int, FontMetrics] = {}
                for page_no in range(len(doc)):
                    size, panels = _page_panels(doc, page_no, len(result.panels), fonts)
                    result.page_size_mm.append(size)
                    result.panels += panels
            finally:
                doc.close()
        span.set_data("pages", len(result.page_size_mm))
        span.set_data("panels", len(result.panels))
        span.set_data("failure_codes", result.failure_codes)
    log.info("extraction finished", extra=kv(file_sha256=sha, pages=len(result.page_size_mm),
                                             panels=len(result.panels), status=result.status,
                                             failure_codes=result.failure_codes))
    return result
