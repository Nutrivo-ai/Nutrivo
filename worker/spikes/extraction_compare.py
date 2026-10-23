"""T-301 spike: pypdfium2 against pdfplumber on the synthetic fixtures (docs/06-extraction.md, "Spike results").

Dev-only and not packaged (the Dockerfile copies worker/src only). It measures, per library and fixture:
  - glyph boxes: the line's horizontal extent against the truth bbox, and the heights tight glyph boxes give
    (cap: flat capitals, x: flat lowercase, figure: tallest digit, each from the baseline);
  - the font programme: x-height and cap-height from the embedded font's outlines of 'x' and 'H' (OS/2 sxHeight and
    sCapHeight when the subset keeps them), scaled by the font size and the text matrix;
  - failure signals per truth panel: text, vector paths and images in the panel's region;
  - wall time and peak memory on a 10-page document built from every fixture page.

  cd worker && uv run python spikes/extraction_compare.py [--fixtures ../fixtures/synth/out] [--json]
"""
from __future__ import annotations

import argparse
import ctypes
import io
import json
import resource
import statistics
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

PT_TO_MM = 25.4 / 72
TOLERANCE_MM = 0.15
FIXTURES = ["clean_3lang", "missing_batch", "small_netqty", "outlined_all", "rasterised", "mixed_9panels"]
# Glyphs whose top sits exactly on the cap line or x line (no overshoot), and whose height is read from the baseline.
FLAT_CAPS = set("BDEFHIKLMNPRTUVWXYZ")
FLAT_X = set("vwxyz")
DIGITS = set("0123456789")
DEFAULT_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "synth" / "out"


@dataclass
class LineMeasure:
    """One truth text object as one library sees it. None means the library could not measure it."""
    key: str
    text: str
    matched: bool = False
    x_extent_err_mm: float | None = None
    box_cap_mm: float | None = None
    box_x_mm: float | None = None
    box_figure_mm: float | None = None
    font_cap_mm: float | None = None
    font_x_mm: float | None = None
    font_source: str | None = None       # 'os2' | 'outline' | None
    truth: dict = field(default_factory=dict)


@dataclass
class PanelSignal:
    index: int
    chars: int
    paths: int
    images: int
    expected: str                         # 'extracted' | 'outlined_text' | 'rasterised'

    @property
    def detected(self) -> str:
        """The dominant signal: a stray line from a neighbouring panel must not make an outlined panel 'extracted'."""
        if not (self.chars or self.paths or self.images):
            return "empty"
        if self.chars >= max(self.paths, self.images):
            return "extracted"
        return "rasterised" if self.images >= self.paths else "outlined_text"


def _to_mm_top_left(x0: float, y0: float, x1: float, y1: float, page_h_pt: float) -> list[float]:
    """PDF user space (origin bottom-left, points) to millimetres from the top-left."""
    return [x0 * PT_TO_MM, (page_h_pt - y1) * PT_TO_MM, x1 * PT_TO_MM, (page_h_pt - y0) * PT_TO_MM]


def _inside(cx: float, cy: float, bbox: list[float], slack: float = 0.3) -> bool:
    return bbox[0] - slack <= cx <= bbox[2] + slack and bbox[1] - slack <= cy <= bbox[3] + slack


def _overlaps(a: list[float], b: list[float]) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def _truth(fixtures: Path, name: str) -> dict:
    return json.loads((fixtures / f"{name}.truth.json").read_text(encoding="utf-8"))


def _truth_lines(truth: dict) -> list[dict]:
    return [o for p in truth["panels"] if p["expected_status"] == "extracted" for o in p["text_objects"]]


def _expected(panel: dict) -> str:
    return panel["expected_failure"] or "extracted"


def _box_heights(glyphs: list[tuple[str, float]]) -> tuple[float | None, float | None, float | None]:
    """glyphs: (char, top above baseline in mm). Cap and x are medians over flat glyphs; figure is the tallest digit."""
    caps = [h for c, h in glyphs if c in FLAT_CAPS]
    xs = [h for c, h in glyphs if c in FLAT_X]
    figs = [h for c, h in glyphs if c in DIGITS]
    return (statistics.median(caps) if caps else None, statistics.median(xs) if xs else None,
            max(figs) if figs else None)


# ── pypdfium2 ─────────────────────────────────────────────────────────────────────────────────────────────
def _pdfium_glyph_top(font, char: str) -> float | None:
    """Top of the glyph outline for a Unicode character, in em; pdfium maps Unicode to the glyph. The font_size
    argument of FPDFFont_GetGlyphPath does not scale the path (measured: 0.729 em for 'H' at 1, 9 and 24 pt)."""
    from pypdfium2 import raw

    path = raw.FPDFFont_GetGlyphPath(font, ord(char), ctypes.c_float(1.0))
    if not path:
        return None
    n = raw.FPDFGlyphPath_CountGlyphSegments(path)
    x, y, top = ctypes.c_float(), ctypes.c_float(), None
    for i in range(n):
        seg = raw.FPDFGlyphPath_GetGlyphPathSegment(path, i)
        if seg and raw.FPDFPathSegment_GetPoint(seg, ctypes.byref(x), ctypes.byref(y)):
            top = y.value if top is None else max(top, y.value)
    return top


def pdfium_measure(pdf: Path, truth: dict) -> tuple[list[LineMeasure], list[PanelSignal], list[list[float]]]:
    import pypdfium2 as pdfium
    from pypdfium2 import raw

    doc = pdfium.PdfDocument(str(pdf))
    page = doc[0]
    w_pt, h_pt = page.get_size()
    tp = page.get_textpage()
    ox, oy = ctypes.c_double(), ctypes.c_double()
    chars = []                                     # (char, tight bbox mm, loose x0/x1 mm, top above baseline mm, i)
    for i in range(tp.count_chars()):
        ch = tp.get_text_range(i, 1)
        if not ch.strip():
            continue
        l, b, r, t = tp.get_charbox(i, loose=False)
        ll, _, lr, _ = tp.get_charbox(i, loose=True)
        raw.FPDFText_GetCharOrigin(tp, i, ctypes.byref(ox), ctypes.byref(oy))
        chars.append((ch, _to_mm_top_left(l, b, r, t, h_pt), (ll * PT_TO_MM, lr * PT_TO_MM),
                      (t - oy.value) * PT_TO_MM, i))

    font_cache: dict[int, tuple[float | None, float | None]] = {}
    lines = []
    for o in _truth_lines(truth):
        m = LineMeasure(o["key"], o["text"], truth=o)
        mine = [c for c in chars if _inside((c[1][0] + c[1][2]) / 2, (c[1][1] + c[1][3]) / 2, o["bbox_mm"])]
        if mine:
            m.matched = True
            m.x_extent_err_mm = max(abs(min(c[2][0] for c in mine) - o["bbox_mm"][0]),
                                    abs(max(c[2][1] for c in mine) - o["bbox_mm"][2]))
            m.box_cap_mm, m.box_x_mm, m.box_figure_mm = _box_heights([(c[0], c[3]) for c in mine])
            obj = tp.get_textobj(mine[0][4])
            size = obj.get_font_size()
            _, b_, _, d, *_ = obj.get_matrix().get()
            scale = (b_ * b_ + d * d) ** 0.5
            font = obj.get_font()
            key = ctypes.addressof(font.raw.contents)
            if key not in font_cache:
                font_cache[key] = (_pdfium_glyph_top(font, "H"), _pdfium_glyph_top(font, "x"))
            cap, xh = font_cache[key]
            m.font_cap_mm = None if cap is None else cap * size * scale * PT_TO_MM
            m.font_x_mm = None if xh is None else xh * size * scale * PT_TO_MM
            m.font_source = "outline" if cap is not None or xh is not None else None
        lines.append(m)

    regions = []                                   # (type, bbox mm) of every page object, forms flattened
    for obj in page.get_objects(max_depth=4):
        if obj.type in (raw.FPDF_PAGEOBJ_TEXT, raw.FPDF_PAGEOBJ_PATH, raw.FPDF_PAGEOBJ_IMAGE):
            regions.append((obj.type, _to_mm_top_left(*obj.get_bounds(), h_pt)))
    signals = []
    for p in truth["panels"]:
        inside = [t for t, bb in regions if _overlaps(bb, p["bbox_mm"])]
        n_chars = sum(1 for c in chars if _inside((c[1][0] + c[1][2]) / 2, (c[1][1] + c[1][3]) / 2, p["bbox_mm"]))
        signals.append(PanelSignal(p["index"], n_chars, inside.count(raw.FPDF_PAGEOBJ_PATH),
                                   inside.count(raw.FPDF_PAGEOBJ_IMAGE), _expected(p)))
    return lines, signals, [[w_pt * PT_TO_MM, h_pt * PT_TO_MM]]


# ── pdfplumber (pdfminer.six underneath) with fontTools on the font stream ────────────────────────────────────────
def _plumber_fonts(page) -> dict[str, tuple[object, object]]:
    """fontname -> (fontTools TTFont, pdfminer font) for every embedded TrueType font on the page."""
    from fontTools.ttLib import TTFont
    from pdfminer.pdftypes import resolve1

    out: dict[str, tuple[object, object]] = {}
    fonts = resolve1(page.page_obj.resources.get("Font")) or {}
    rsrc = page.pdf.rsrcmgr if hasattr(page.pdf, "rsrcmgr") else None
    for ref in fonts.values():
        spec = resolve1(ref)
        desc = resolve1(spec.get("FontDescriptor"))
        if not desc or "FontFile2" not in desc:
            continue                               # standard 14 or not embedded: no programme to measure
        name = resolve1(spec["BaseFont"]).name
        tt = TTFont(io.BytesIO(resolve1(desc["FontFile2"]).get_data()))
        miner = rsrc.get_font(None, spec) if rsrc else None
        out[name] = (tt, miner)
    return out


def _fonttools_tops(tt, miner) -> tuple[tuple[float | None, float | None], str | None]:
    """(cap, x) in em from OS/2 when present, else the outlines of 'H' and 'x' reached through ToUnicode and cmap."""
    from fontTools.pens.boundsPen import BoundsPen

    upm = tt["head"].unitsPerEm
    os2 = tt.get("OS/2")
    if os2 is not None and getattr(os2, "sCapHeight", 0) and getattr(os2, "sxHeight", 0):
        return (os2.sCapHeight / upm, os2.sxHeight / upm), "os2"
    # A subset has no Unicode cmap: Unicode -> PDF code through the font's ToUnicode, code -> glyph through the
    # symbolic (1,0)/(3,0) cmap the subset keeps.
    code_of: dict[str, int] = {}
    umap = getattr(miner, "unicode_map", None)
    for code, uni in (getattr(umap, "cid2unichr", None) or {}).items():
        code_of.setdefault(uni, code)
    glyph_of: dict[int, str] = {}
    for st in tt["cmap"].tables:
        for code, gname in st.cmap.items():
            glyph_of.setdefault(code & 0xFF if st.platformID == 3 and st.platEncID == 0 else code, gname)
    gs = tt.getGlyphSet()

    def top(ch: str) -> float | None:
        code = code_of.get(ch)
        gname = glyph_of.get(code) if code is not None else None
        if gname is None or gname not in gs:
            return None
        pen = BoundsPen(gs)
        gs[gname].draw(pen)
        return None if pen.bounds is None else pen.bounds[3] / upm

    cap, x = top("H"), top("x")
    return (cap, x), ("outline" if cap is not None or x is not None else None)


def plumber_measure(pdf: Path, truth: dict) -> tuple[list[LineMeasure], list[PanelSignal], list[list[float]]]:
    import pdfplumber

    with pdfplumber.open(str(pdf)) as doc:
        page = doc.pages[0]
        fonts = _plumber_fonts(page)
        tops = {name: _fonttools_tops(tt, miner) for name, (tt, miner) in fonts.items()}
        chars = [c for c in page.chars if c["text"].strip()]
        lines = []
        for o in _truth_lines(truth):
            m = LineMeasure(o["key"], o["text"], truth=o)
            mine = [c for c in chars if _inside((c["x0"] + c["x1"]) / 2 * PT_TO_MM,
                                                (c["top"] + c["bottom"]) / 2 * PT_TO_MM, o["bbox_mm"])]
            if mine:
                m.matched = True
                m.x_extent_err_mm = max(abs(min(c["x0"] for c in mine) * PT_TO_MM - o["bbox_mm"][0]),
                                        abs(max(c["x1"] for c in mine) * PT_TO_MM - o["bbox_mm"][2]))
                # pdfplumber's char box is the font-size box (bottom - top == size): no tight glyph heights.
                c0 = mine[0]
                scale_pt = c0["size"]                     # pdfminer's size: font size times the text matrix scale
                (cap, xh), source = tops.get(c0["fontname"], ((None, None), None))
                m.font_cap_mm = None if cap is None else cap * scale_pt * PT_TO_MM
                m.font_x_mm = None if xh is None else xh * scale_pt * PT_TO_MM
                m.font_source = source
            lines.append(m)

        signals = []
        for p in truth["panels"]:
            def n(objs, bbox=p["bbox_mm"]):
                return sum(1 for o in objs if _overlaps([o["x0"] * PT_TO_MM, o["top"] * PT_TO_MM,
                                                         o["x1"] * PT_TO_MM, o["bottom"] * PT_TO_MM], bbox))
            signals.append(PanelSignal(p["index"], n(chars), n(page.curves) + n(page.rects) + n(page.lines),
                                       n(page.images), _expected(p)))
        return lines, signals, [[float(page.width) * PT_TO_MM, float(page.height) * PT_TO_MM]]


LIBRARIES = {"pypdfium2": pdfium_measure, "pdfplumber": plumber_measure}


# ── budget: a 10-page document, each library in its own process so peak RSS is its own ───────────────────────────
def _budget_child(lib: str, pdf: Path) -> None:
    t0 = time.perf_counter()
    n = 0
    if lib == "pypdfium2":
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(str(pdf))
        for page in doc:
            tp = page.get_textpage()
            for i in range(tp.count_chars()):
                tp.get_charbox(i, loose=False)
                n += 1
            list(page.get_objects(max_depth=4))
    else:
        import pdfplumber

        with pdfplumber.open(str(pdf)) as doc:
            for page in doc.pages:
                n += len(page.chars) + len(page.curves) + len(page.rects) + len(page.images)
                page.close()
    # VmHWM is this process image's own high-water mark; ru_maxrss carries the parent's over fork and exec.
    status = Path("/proc/self/status")
    hwm = [ln for ln in status.read_text().splitlines() if ln.startswith("VmHWM:")] if status.exists() else []
    rss_kb = int(hwm[0].split()[1]) if hwm else resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    print(json.dumps({"seconds": round(time.perf_counter() - t0, 3), "peak_rss_mb": round(rss_kb / 1024, 1),
                      "objects": n}))


def budget(fixtures: Path, pages: int = 10) -> dict:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    sources = [fixtures / f"{name}.pdf" for name in FIXTURES]
    while len(writer.pages) < pages:
        for src in sources:
            if len(writer.pages) < pages:
                writer.add_page(PdfReader(str(src)).pages[0])
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "ten_pages.pdf"
        with path.open("wb") as fh:
            writer.write(fh)
        out = {}
        for lib in LIBRARIES:
            done = subprocess.run([sys.executable, __file__, "--budget-child", lib, str(path)],
                                  check=True, capture_output=True, text=True)
            out[lib] = json.loads(done.stdout.strip().splitlines()[-1])
        return out


# ── summary ──────────────────────────────────────────────────────────────────────────────────────────────────
def _err(values: list[tuple[float | None, float]]) -> dict:
    measured = [(m, t) for m, t in values if m is not None]
    errs = [abs(m - t) for m, t in measured]
    return {"measured": len(measured), "of": len(values), "max_err_mm": round(max(errs), 3) if errs else None,
            "within_tol": sum(1 for e in errs if e <= TOLERANCE_MM)}


def run(fixtures: Path = DEFAULT_FIXTURES, with_budget: bool = True) -> dict:
    report: dict = {"tolerance_mm": TOLERANCE_MM, "fixtures": {}}
    for name in FIXTURES:
        truth = _truth(fixtures, name)
        report["fixtures"][name] = {}
        for lib, measure in LIBRARIES.items():
            t0 = time.perf_counter()
            lines, signals, sizes = measure(fixtures / f"{name}.pdf", truth)
            seconds = time.perf_counter() - t0
            report["fixtures"][name][lib] = {
                "seconds": round(seconds, 3),
                "page_size_err_mm": round(max(abs(a - b) for a, b in zip(sizes[0], truth["page_size_mm"])), 3),
                "lines_matched": sum(m.matched for m in lines), "lines": len(lines),
                "x_extent": _err([(m.x_extent_err_mm, 0.0) for m in lines]),
                "box_cap": _err([(m.box_cap_mm, m.truth["cap_mm"]) for m in lines]),
                "box_x": _err([(m.box_x_mm, m.truth["x_mm"]) for m in lines]),
                "box_figure": _err([(m.box_figure_mm, m.truth["figure_mm"]) for m in lines
                                    if any(ch in DIGITS for ch in m.text)]),
                "font_cap": _err([(m.font_cap_mm, m.truth["cap_mm"]) for m in lines]),
                "font_x": _err([(m.font_x_mm, m.truth["x_mm"]) for m in lines]),
                "font_sources": sorted({m.font_source for m in lines if m.font_source}),
                "panels": [asdict(s) | {"detected": s.detected} for s in signals],
                "panels_detected_as_expected": sum(s.detected == s.expected for s in signals),
            }
    if with_budget:
        report["budget_10_pages"] = budget(fixtures)
    return report


def _cell(e: dict) -> str:
    """'within tolerance / measured of lines · max error'; a line without the glyphs a method needs is not measured."""
    if not e["of"]:
        return "–"
    if not e["measured"]:
        return f"n/a ({e['of']})"
    return f"{e['within_tol']}/{e['measured']} of {e['of']} · max {e['max_err_mm']:.3f}"


def markdown(report: dict) -> str:
    rows = ["| Fixture | Library | Lines | x-extent | Box cap | Box x | Box figure | Font cap | Font x | Panels |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for name, libs in report["fixtures"].items():
        for lib, r in libs.items():
            rows.append(f"| {name} | {lib} | {r['lines_matched']}/{r['lines']} | {_cell(r['x_extent'])} | "
                        f"{_cell(r['box_cap'])} | {_cell(r['box_x'])} | {_cell(r['box_figure'])} | "
                        f"{_cell(r['font_cap'])} | {_cell(r['font_x'])} | "
                        f"{r['panels_detected_as_expected']}/{len(r['panels'])} |")
    if "budget_10_pages" in report:
        rows += ["", "| Library | 10 pages (s) | Peak RSS (MB) |", "|---|---|---|"]
        for lib, b in report["budget_10_pages"].items():
            rows.append(f"| {lib} | {b['seconds']} | {b['peak_rss_mb']} |")
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    ap.add_argument("--json", action="store_true", help="the full report as JSON instead of the Markdown table")
    ap.add_argument("--no-budget", action="store_true")
    ap.add_argument("--budget-child", nargs=2, metavar=("LIB", "PDF"), help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.budget_child:
        _budget_child(args.budget_child[0], Path(args.budget_child[1]))
        return 0
    report = run(args.fixtures, with_budget=not args.no_budget)
    print(json.dumps(report, indent=2) if args.json else markdown(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
