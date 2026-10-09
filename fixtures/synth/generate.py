#!/usr/bin/env python3
"""Synthetic pet-food labels: print-accurate vector PDFs with exact ground truth.

Why: until pilots share real artwork, these are the oracle for extraction (BE-16/17/18) and the engine.
Every page is drawn at true physical size, so the character heights in the truth files are exact.
The wording comes from terms.json and is NOT regulatory content.

Usage:  python fixtures/synth/generate.py [--out fixtures/synth/out]
Needs:  reportlab, fonttools, pypdf (worker dev deps); ghostscript (gs) and poppler (pdftoppm) on PATH.
"""
from __future__ import annotations

import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont as FTFont
from pypdf import PdfReader, PdfWriter
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
PT_TO_MM = 25.4 / 72
FONT_PATHS = [HERE / "fonts" / "DejaVuSans.ttf", Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
              Path("/opt/homebrew/share/fonts/DejaVuSans.ttf"), Path("/Library/Fonts/DejaVuSans.ttf")]
TERMS = json.loads((HERE / "terms.json").read_text(encoding="utf-8"))
BODY_PT, HEAD_PT, TYPE_PT = 6.5, 7.5, 9.0


class Metrics:
    """Glyph-measured ratios (per em) for the font actually embedded."""
    def __init__(self, path: Path):
        f = FTFont(str(path)); upm = f["head"].unitsPerEm; gs = f.getGlyphSet(); cmap = f.getBestCmap()
        def top(ch):
            pen = BoundsPen(gs); gs[cmap[ord(ch)]].draw(pen); return pen.bounds[3] / upm
        self.cap, self.x = top("H"), top("x")
        self.fig = max(top(d) for d in "0123456789")
        self.asc, self.desc = f["hhea"].ascent / upm, -f["hhea"].descent / upm

    def heights(self, pt: float) -> dict:
        return {"cap_mm": round(pt * self.cap * PT_TO_MM, 3), "x_mm": round(pt * self.x * PT_TO_MM, 3),
                "figure_mm": round(pt * self.fig * PT_TO_MM, 3)}

    def pt_for_figure_mm(self, target_mm: float) -> float:
        return target_mm / (self.fig * PT_TO_MM)


def wrap(text: str, width_mm: float, pt: float) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(trial, "Body", pt) * PT_TO_MM <= width_mm or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    return lines + ([cur] if cur else [])


def draw_panel(c, m: Metrics, page_h: float, box: list[float], lang: str, idx: int, spec: dict) -> dict:
    """Draw one language panel; return its truth record. box = [x0, y0, x1, y1] mm, top-left origin."""
    t, (x0, y0, x1, _y1) = TERMS[lang], box
    width, x, y = x1 - x0 - 6, x0 + 3, y0 + 3
    missing = set(spec.get("missing", []))
    objects, particulars = [], {}

    def line(key, text, pt):
        nonlocal y
        y += m.asc * pt * PT_TO_MM                      # move to baseline
        c.setFont("Body", pt); c.drawString(x * mm, (page_h - y) * mm, text)
        w = pdfmetrics.stringWidth(text, "Body", pt) * PT_TO_MM
        rec = {"key": key, "text": text, "font_size_pt": pt,
               "bbox_mm": [round(x, 3), round(y - m.asc * pt * PT_TO_MM, 3), round(x + w, 3),
                           round(y + m.desc * pt * PT_TO_MM, 3)], **m.heights(pt)}
        objects.append(rec); particulars.setdefault(key, rec)
        y += m.desc * pt * PT_TO_MM + 0.8

    def block(key, heading, body, pt=BODY_PT):
        line(key, heading + ":", HEAD_PT)
        for ln in wrap(body, width, pt):
            line(key + "_text", ln, pt)

    line("type_of_feed", t["type"], TYPE_PT)
    block("composition", t["composition"], t["ingredients"])
    block("analytical_constituents", t["analytical"],
          f'{t["protein"]} 32 %, {t["fat"]} 14 %, {t["fibre"]} 2.5 %, {t["ash"]} 7 %, {t["moisture"]} 8 %')
    block("additives", t["additives"], t["additives_list"])
    block("feeding_instructions", t["feeding"], t["feeding_text"])
    line("operator", "Nordic Pet Foods AB, Exempelgatan 1, 111 22 Stockholm, Sweden", BODY_PT)
    line("approval_number", f'{t["approval"]} SE-12345', BODY_PT)
    if "batch" not in missing:
        line("batch", f'{t["batch"]}: L2611-07', BODY_PT)
    line("best_before", f'{t["best_before"]}: 11/2027', BODY_PT)
    line("contact", f'{t["contact"]}: 020-123 45 67', BODY_PT)
    net_pt = m.pt_for_figure_mm(spec.get("netqty_mm", 6.2))
    line("net_quantity", spec.get("netqty_text", "1,5 kg"), net_pt)
    return {"index": idx, "language": lang, "bbox_mm": box, "particulars": particulars,
            "missing": sorted(missing), "text_objects": objects}


def grid(cols: int, rows: int, pw: float, ph: float, gutter: float = 6.0):
    return [[gutter + c * (pw + gutter), gutter + r * (ph + gutter), gutter + c * (pw + gutter) + pw,
             gutter + r * (ph + gutter) + ph] for r in range(rows) for c in range(cols)]


def render(path: Path, m: Metrics, size: tuple[float, float], panels: list[dict], only: int | None = None) -> list[dict]:
    c = canvas.Canvas(str(path), pagesize=(size[0] * mm, size[1] * mm))
    truth = []
    for p in panels:
        if only is None or p["index"] == only:
            truth.append(draw_panel(c, m, size[1], p["box"], p["lang"], p["index"], p))
    c.showPage(); c.save()
    return truth


def outline(src: Path, dst: Path):
    subprocess.run(["gs", "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-dNoOutputFonts",
                    f"-sOutputFile={dst}", str(src)], check=True)


def rasterise(src: Path, dst: Path, size: tuple[float, float]):
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["pdftoppm", "-r", "300", "-png", "-singlefile", str(src), f"{td}/page"], check=True)
        c = canvas.Canvas(str(dst), pagesize=(size[0] * mm, size[1] * mm))
        c.drawImage(f"{td}/page.png", 0, 0, size[0] * mm, size[1] * mm); c.showPage(); c.save()


FIXTURES = [
    {"name": "clean_3lang", "cols": 3, "rows": 1, "langs": ["en", "sv", "de"], "post": None,
     "why": "All particulars present, correct net-quantity figure height. Expect: extracted, no defects."},
    {"name": "missing_batch", "cols": 3, "rows": 1, "langs": ["en", "sv", "de"], "post": None,
     "panel_overrides": {1: {"missing": ["batch"]}},
     "why": "Swedish panel has no batch reference. Expect one action finding on panel 1 only."},
    {"name": "small_netqty", "cols": 1, "rows": 1, "langs": ["sv"], "post": None,
     "panel_overrides": {0: {"netqty_mm": 4.0}},
     "why": "1,5 kg with 4.0 mm figures; Dir. 76/211/EEC bands (candidate) require 6 mm above 1000 g."},
    {"name": "outlined_all", "cols": 3, "rows": 1, "langs": ["en", "sv", "de"], "post": "outline",
     "why": "Text converted to outlines. Expect every panel not_assessable: outlined_text."},
    {"name": "rasterised", "cols": 3, "rows": 1, "langs": ["en", "sv", "de"], "post": "raster",
     "why": "Flattened to a 300 dpi image. Expect not_assessable: rasterised for the page."},
    {"name": "mixed_9panels", "cols": 3, "rows": 3, "langs": ["en", "sv", "da", "fi", "de", "en", "sv", "da", "fi"],
     "post": "mixed", "outlined_panels": [2, 5, 7],
     "why": "BE-18: nine panels, three outlined. Expect six extracted and three named failures."},
]


def build(spec: dict, m: Metrics, out: Path):
    pw, ph = 70.0, 100.0
    boxes = grid(spec["cols"], spec["rows"], pw, ph)
    size = (spec["cols"] * (pw + 6) + 6, spec["rows"] * (ph + 6) + 6)
    panels = [{"index": i, "lang": lang, "box": boxes[i], **spec.get("panel_overrides", {}).get(i, {})}
              for i, lang in enumerate(spec["langs"])]
    pdf = out / f'{spec["name"]}.pdf'
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        if spec["post"] == "mixed":
            parts, truth = [], []
            for p in panels:
                part = td / f'p{p["index"]}.pdf'
                truth += render(part, m, size, panels, only=p["index"])
                if p["index"] in spec["outlined_panels"]:
                    outline(part, td / f'o{p["index"]}.pdf'); part = td / f'o{p["index"]}.pdf'
                parts.append(part)
            base = PdfReader(str(parts[0])).pages[0]
            for part in parts[1:]:
                base.merge_page(PdfReader(str(part)).pages[0])
            w = PdfWriter(); w.add_page(base)
            with open(pdf, "wb") as fh: w.write(fh)
        else:
            clean = td / "clean.pdf"
            truth = render(clean, m, size, panels)
            if spec["post"] == "outline": outline(clean, pdf)
            elif spec["post"] == "raster": rasterise(clean, pdf, size)
            else: shutil.copy(clean, pdf)

    failed = set(spec.get("outlined_panels", []))
    for p in truth:
        if spec["post"] == "outline" or p["index"] in failed:
            p["expected_status"], p["expected_failure"] = "not_assessable", "outlined_text"
        elif spec["post"] == "raster":
            p["expected_status"], p["expected_failure"] = "not_assessable", "rasterised"
        else:
            p["expected_status"], p["expected_failure"] = "extracted", None
    sample = [o for p in truth if p["expected_status"] == "extracted"
              for o in p["text_objects"] if o["key"] in ("net_quantity", "composition", "type_of_feed")]
    (out / f'{spec["name"]}.truth.json').write_text(json.dumps({
        "fixture": spec["name"], "why": spec["why"], "page_size_mm": [round(size[0], 3), round(size[1], 3)],
        "coordinate_system": "mm, origin top-left of the page", "font": "DejaVu Sans (embedded)",
        "panels": truth, "text_objects_sample": sample}, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(HERE / "out"))
    args = ap.parse_args()
    for tool in ("gs", "pdftoppm"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found on PATH (macOS: brew install ghostscript poppler)")
    font = next((p for p in FONT_PATHS if p.exists()), None)
    if font is None:
        sys.exit("DejaVuSans.ttf not found. Put it in fixtures/synth/fonts/ (free licence) and re-run.")
    pdfmetrics.registerFont(TTFont("Body", str(font)))
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    m = Metrics(font)
    for spec in FIXTURES:
        build(spec, m, out)
        print(f'  {spec["name"]:<16} {spec["why"]}')
    print(f"wrote {len(FIXTURES)} fixtures to {out}")


if __name__ == "__main__":
    main()
