"""T-301: the extraction spike (worker/spikes/extraction_compare.py) keeps measuring what docs/06-extraction.md says
it measured. Needs `make fixtures`."""
import importlib.util
import sys
from pathlib import Path

import pytest

SPIKE = Path(__file__).resolve().parents[1] / "spikes" / "extraction_compare.py"


def _load():
    spec = importlib.util.spec_from_file_location("extraction_compare", SPIKE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ec = _load()
pytestmark = pytest.mark.skipif(not (ec.DEFAULT_FIXTURES / "clean_3lang.pdf").exists(), reason="run make fixtures")
TEXT_FIXTURES = ["clean_3lang", "missing_batch", "small_netqty", "mixed_9panels"]


@pytest.fixture(scope="module")
def report():
    return ec.run(with_budget=False)


@pytest.mark.parametrize("name", TEXT_FIXTURES)
def test_pypdfium2_glyph_boxes_and_font_outlines_measure_both_heights_within_tolerance(report, name):
    r = report["fixtures"][name]["pypdfium2"]
    assert r["lines_matched"] == r["lines"] > 0
    for metric in ("x_extent", "box_cap", "box_x", "box_figure", "font_cap", "font_x"):
        e = r[metric]
        assert e["measured"] and e["within_tol"] == e["measured"], (metric, e)
    assert r["font_cap"]["measured"] == r["font_x"]["measured"] == r["lines"]   # BE-17: both, on every line
    assert r["page_size_err_mm"] < 0.01


@pytest.mark.parametrize("name", TEXT_FIXTURES)
def test_pdfplumber_reaches_the_font_programme_but_has_no_tight_glyph_boxes(report, name):
    r = report["fixtures"][name]["pdfplumber"]
    assert r["lines_matched"] == r["lines"]
    assert r["font_cap"]["within_tol"] == r["font_x"]["within_tol"] == r["lines"]
    assert r["box_cap"]["measured"] == r["box_x"]["measured"] == r["box_figure"]["measured"] == 0


def test_subset_fonts_carry_no_os2_heights_so_both_libraries_fall_back_to_outlines(report):
    for libs in report["fixtures"].values():
        for r in libs.values():
            assert r["font_sources"] in ([], ["outline"])


@pytest.mark.parametrize("lib", ["pypdfium2", "pdfplumber"])
def test_both_libraries_see_the_failure_signal_of_every_panel(report, lib):
    for name, libs in report["fixtures"].items():
        panels = libs[lib]["panels"]
        assert all(p["detected"] == p["expected"] for p in panels), (name, panels)
    mixed = report["fixtures"]["mixed_9panels"][lib]["panels"]
    assert sorted(p["index"] for p in mixed if p["detected"] == "outlined_text") == [2, 5, 7]


def test_a_stray_overflowing_line_does_not_make_an_outlined_panel_extracted():
    assert ec.PanelSignal(2, chars=2, paths=452, images=0, expected="outlined_text").detected == "outlined_text"
    assert ec.PanelSignal(0, chars=0, paths=0, images=1, expected="rasterised").detected == "rasterised"
    assert ec.PanelSignal(0, chars=0, paths=0, images=0, expected="extracted").detected == "empty"


def test_pdfium_glyph_path_is_in_em_and_absent_glyphs_are_none_not_substituted():
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(ec.DEFAULT_FIXTURES / "clean_3lang.pdf"))
    font = doc[0].get_textpage().get_textobj(0).get_font()
    assert 0.72 < ec._pdfium_glyph_top(font, "H") < 0.74          # DejaVu Sans cap height, 0.729 em
    assert ec._pdfium_glyph_top(font, "Ω") is None


def test_ten_pages_fit_the_extraction_budget():
    b = ec.budget(ec.DEFAULT_FIXTURES)
    for lib, r in b.items():
        assert r["seconds"] < 20 and r["peak_rss_mb"] < 1024, (lib, r)
    assert b["pypdfium2"]["seconds"] < b["pdfplumber"]["seconds"]


def test_markdown_table_has_a_row_per_fixture_and_library(report):
    table = ec.markdown(report)
    assert table.count("\n| ") >= 2 * len(ec.FIXTURES)
