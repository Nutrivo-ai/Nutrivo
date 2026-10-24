"""T-302: nutrivo_worker.extraction beyond the BE-16/17/18 gates: every fixture against its truth file, the deliberate
gutter overflow (#39), missing fonts, unreadable files, placement scale, idempotency, the 20 s / 1 GB budget and
pdfplumber kept out of production code (D-15). Needs `make fixtures`."""
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from nutrivo_worker.extraction import FAILURE_CODES, engine, extract_artwork, idempotency_key, language
from nutrivo_worker.extraction.layout import Item, cluster, dominant_signal

ROOT = Path(__file__).resolve().parents[2]
SYNTH = ROOT / "fixtures" / "synth" / "out"
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FIXTURES = ["clean_3lang", "missing_batch", "small_netqty", "outlined_all", "rasterised", "mixed_9panels",
            "gutter_overflow"]
TOL = 0.15

pytestmark = pytest.mark.skipif(not (SYNTH / "gutter_overflow.pdf").exists(), reason="run make fixtures")


def _truth(name):
    return json.loads((SYNTH / f"{name}.truth.json").read_text(encoding="utf-8"))


def _overlaps(a, b, slack=1.0):
    return a[0] < b[2] + slack and a[2] > b[0] - slack and a[1] < b[3] + slack and a[3] > b[1] - slack


# ── every fixture against its truth ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name", [n for n in FIXTURES if n != "rasterised"])
def test_panels_statuses_and_languages_match_the_truth(name):
    truth, result = _truth(name), extract_artwork(SYNTH / f"{name}.pdf")
    assert len(result.panels) == len(truth["panels"])
    assert [p.index for p in result.panels] == list(range(len(result.panels)))
    for got, want in zip(result.panels, truth["panels"], strict=True):
        assert (got.status, got.failure_code) == (want["expected_status"], want["expected_failure"]), got.index
        assert got.language == (want["language"] if want["expected_status"] == "extracted" else "und")
        assert got.failure_code is None or got.failure_code in FAILURE_CODES
        assert bool(got.text_objects) == (got.status == "extracted")
        x0, y0, x1, y1 = want["bbox_mm"]
        assert x0 - 0.5 <= got.bbox_mm[0] and got.bbox_mm[2] <= x1 + 0.5      # inside its printed panel
        assert y0 - 0.5 <= got.bbox_mm[1] and got.bbox_mm[3] <= y1 + 0.5


def test_a_rasterised_page_is_one_named_failure_for_the_page():
    result = extract_artwork(SYNTH / "rasterised.pdf")
    assert [(p.status, p.failure_code) for p in result.panels] == [("not_assessable", "rasterised")]
    assert result.status == "failed" and result.failure_codes == ["rasterised"]


@pytest.mark.parametrize("name", ["clean_3lang", "missing_batch", "small_netqty", "mixed_9panels", "gutter_overflow"])
def test_every_truth_line_is_one_text_object_with_both_heights_within_tolerance(name):
    truth, result = _truth(name), extract_artwork(SYNTH / f"{name}.pdf")
    by_index = {p.index: p for p in result.panels}
    for want in truth["panels"]:
        if want["expected_status"] != "extracted":
            continue
        objects = by_index[want["index"]].text_objects
        assert [o.text for o in objects] == [t["text"] for t in want["text_objects"]]
        for o, t in zip(objects, want["text_objects"], strict=True):
            assert abs(o.cap_height_mm - t["cap_mm"]) <= TOL and abs(o.x_height_mm - t["x_mm"]) <= TOL, t["key"]
            assert all(abs(a - b) <= TOL for a, b in zip(o.bbox_mm[1::2], t["bbox_mm"][1::2], strict=True)) \
                or _overlaps(o.bbox_mm, t["bbox_mm"]), t["key"]
            assert o.confidence in (1.0, 0.8) and o.height_source == "outline"


def test_every_line_is_wrapped_inside_its_panel_except_the_deliberate_overflow():
    for name in FIXTURES:
        for p in _truth(name)["panels"]:
            for o in p["text_objects"]:
                if o["key"] != "gutter_overflow":
                    assert o["bbox_mm"][2] <= p["bbox_mm"][2], (name, p["index"], o["key"])


# ── the deliberate gutter overflow (#39) ────────────────────────────────────────────────────────────────────
def test_a_line_crossing_the_gutter_belongs_to_the_panel_where_it_starts():
    truth, result = _truth("gutter_overflow"), extract_artwork(SYNTH / "gutter_overflow.pdf")
    assert truth["expected_attribution"]
    assert [p.language for p in result.panels] == ["en", "sv", "de"]
    for want in truth["expected_attribution"]:
        holders = [p.index for p in result.panels for o in p.text_objects if o.text == want["text"]]
        assert holders == [want["panel_index"]]
    crossing = next(o for o in result.panels[0].text_objects if o.text == truth["expected_attribution"][0]["text"])
    assert crossing.bbox_mm[2] > result.panels[1].bbox_mm[0]          # it really runs into panel 1's area
    assert result.panels[0].bbox_mm[2] < result.panels[1].bbox_mm[0]  # the panel itself stops at the gutter


def test_clustering_tolerates_two_crossing_lines_but_rows_need_a_clear_band():
    def text(x0, y0, x1, y1):
        return Item("text", [x0, y0, x1, y1])
    left = [text(10, y, 60, y + 2) for y in range(10, 40, 3)]
    right = [text(80, y, 130, y + 2) for y in range(10, 40, 3)]
    over = [text(10, 41, 100, 43)]
    panels = cluster(left + right + over, 150, 100)
    assert len(panels) == 2 and over[0] in panels[0].items and panels[0].bbox[2] <= 70
    assert len(cluster(left + right + over * 3, 150, 100)) == 1      # three crossing lines: no gutter there
    tall = [text(10, 10, 60, 12), text(10, 13, 60, 21), text(10, 22, 60, 24)]
    assert len(cluster(tall, 150, 100)) == 1                          # a tall line is not a row gutter


def test_ragged_right_text_is_not_split_into_columns():
    items = [Item("text", [10, y, 60 if y % 2 else 20, y + 2]) for y in range(10, 60, 3)]
    assert len(cluster(items, 100, 100)) == 1


def test_the_dominant_signal_decides_not_any_text():
    assert dominant_signal(chars=2, paths=452, images=0) == "outlined_text"
    assert dominant_signal(chars=900, paths=12, images=1) == "extracted"
    assert dominant_signal(chars=0, paths=0, images=1) == "rasterised"


# ── named failures, never a file-level error ───────────────────────────────────────────────────────────────
def _draw(path: Path, font: str, scale: float = 1.0):
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    if font == "Body":
        pdfmetrics.registerFont(TTFont("Body", str(FONT)))
    c = canvas.Canvas(str(path), pagesize=(100 * mm, 60 * mm))
    c.scale(scale, scale)
    c.setFont(font, 20)
    c.drawString(10 * mm / scale, 30 * mm / scale, "Hexane Taxi Box")
    c.drawString(10 * mm / scale, 20 * mm / scale, "Complete feed for dogs and cats")
    c.showPage()
    c.save()


def test_text_without_an_embedded_font_is_missing_font_not_a_guess(tmp_path):
    pdf = tmp_path / "helvetica.pdf"
    _draw(pdf, "Helvetica")                                        # a standard-14 font: no programme embedded
    result = extract_artwork(pdf)
    assert [(p.status, p.failure_code, p.text_objects) for p in result.panels] == \
        [("not_assessable", "missing_font", [])]


@pytest.mark.skipif(not FONT.exists(), reason="DejaVu Sans not installed")
def test_heights_follow_the_placement_scale(tmp_path):
    pdf = tmp_path / "half.pdf"
    _draw(pdf, "Body", scale=0.5)                                  # 20 pt drawn at 50 %: 10 pt on paper
    objects = extract_artwork(pdf).panels[0].text_objects
    cap_10pt, x_10pt = 0.729 * 10 * 25.4 / 72, 0.547 * 10 * 25.4 / 72  # DejaVu Sans: H 0.729 em, x 0.547 em
    assert objects and all(abs(o.cap_height_mm - cap_10pt) <= 0.02 and abs(o.x_height_mm - x_10pt) <= 0.02
                           for o in objects)
    assert objects[0].confidence == 1.0 and objects[0].font_size_pt == 10.0   # cross-checked against glyph boxes


@pytest.mark.parametrize("content", [b"", b"%PDF-1.7\n garbage", b"\x89PNG\r\n\x1a\n not a pdf"])
def test_an_unreadable_file_is_a_named_panel_not_an_exception(tmp_path, content):
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(content)
    result = extract_artwork(bad)
    assert [(p.status, p.failure_code) for p in result.panels] == [("not_assessable", "unreadable")]
    assert result.status == "failed"


def test_a_page_that_fails_to_parse_is_unreadable_and_reported(monkeypatch):
    captured = []

    def boom(*_a, **_k):
        raise RuntimeError("label text must not leak")
    monkeypatch.setattr(engine, "_chars", boom)
    monkeypatch.setattr(engine.sentry_sdk, "capture_exception", captured.append)
    result = extract_artwork(SYNTH / "clean_3lang.pdf")
    assert [(p.page, p.failure_code) for p in result.panels] == [(0, "unreadable")]
    assert len(captured) == 1 and result.page_size_mm == [(234.0, 112.0)]


def test_mixed_results_are_partial_with_their_failure_codes():
    result = extract_artwork(SYNTH / "mixed_9panels.pdf")
    assert result.status == "partial" and result.failure_codes == ["outlined_text"]
    assert extract_artwork(SYNTH / "clean_3lang.pdf").status == "succeeded"


# ── idempotent per file hash ───────────────────────────────────────────────────────────────────────────────
def test_extraction_is_idempotent_per_file_hash(tmp_path):
    from dataclasses import asdict

    first, second = extract_artwork(SYNTH / "mixed_9panels.pdf"), extract_artwork(SYNTH / "mixed_9panels.pdf")
    assert asdict(first) == asdict(second)
    assert first.idempotency_key == idempotency_key(first.file_sha256)
    copy = tmp_path / "renamed.pdf"
    copy.write_bytes((SYNTH / "mixed_9panels.pdf").read_bytes())
    assert extract_artwork(copy).idempotency_key == first.idempotency_key    # the hash, not the name
    assert extract_artwork(SYNTH / "clean_3lang.pdf").idempotency_key != first.idempotency_key
    assert first.engine == "pypdfium2+fonttools" and "PDFium" in first.engine_version


# ── language ───────────────────────────────────────────────────────────────────────────────────────────────
def test_language_per_panel_text_and_und_when_too_short():
    terms = json.loads((ROOT / "fixtures" / "synth" / "terms.json").read_text(encoding="utf-8"))
    for code in ("en", "sv", "da", "fi", "de"):
        t = terms[code]
        assert language.detect(f'{t["type"]}. {t["ingredients"]}. {t["feeding_text"]}')[0] == code
    assert language.detect("1,5 kg") == ("und", None)


# ── D-15 and the budget ────────────────────────────────────────────────────────────────────────────────────
def test_production_code_never_uses_pdfplumber_or_pymupdf():
    src = Path(engine.__file__).resolve().parents[1]
    for py in src.rglob("*.py"):
        code = py.read_text(encoding="utf-8")
        for banned in ("import pdfplumber", "from pdfplumber", "pdfminer", "import fitz", "pymupdf"):
            assert banned not in code.lower(), (py, banned)
    project = (src.parents[1] / "pyproject.toml").read_text(encoding="utf-8")
    deps = project.split("dependencies = [", 1)[1].split("]", 1)[0].lower()
    assert "pdfplumber" not in deps and "pymupdf" not in deps


def test_ten_pages_extract_within_20_s_and_1_gb(tmp_path):
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    while len(writer.pages) < 10:
        for name in FIXTURES:
            if len(writer.pages) < 10:
                writer.add_page(PdfReader(str(SYNTH / f"{name}.pdf")).pages[0])
    pdf = tmp_path / "ten.pdf"
    with pdf.open("wb") as fh:
        writer.write(fh)
    child = textwrap.dedent(f"""
        import json, time
        from pathlib import Path
        t0 = time.perf_counter()
        from nutrivo_worker.extraction import extract_artwork
        r = extract_artwork({str(pdf)!r})
        hwm = [l for l in Path("/proc/self/status").read_text().splitlines() if l.startswith("VmHWM:")]
        print(json.dumps({{"s": time.perf_counter() - t0, "mb": int(hwm[0].split()[1]) / 1024 if hwm else 0,
                           "pages": len(r.page_size_mm)}}))
    """)
    out = json.loads(subprocess.run([sys.executable, "-c", child], check=True, capture_output=True,
                                    text=True).stdout.strip().splitlines()[-1])
    assert out["pages"] == 10 and out["s"] < 20 and out["mb"] < 1024, out
