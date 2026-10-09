"""GATES BE-16 BE-17 BE-18 · artwork extraction. Human-owned: Claude Code must not edit this file.

Contract (docs/06-extraction.md):
    from nutrivo_worker.extraction import extract_artwork
    result = extract_artwork(path)          # -> object with .panels
    panel: .index .bbox_mm .language .status ('extracted'|'not_assessable') .failure_code .text_objects
    text object: .text .bbox_mm .font_size_pt .x_height_mm .cap_height_mm   (mm, origin top-left)
Fixtures: `make fixtures` writes fixtures/synth/out/*.pdf and *.truth.json.
"""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SYNTH = ROOT / "fixtures" / "synth" / "out"
TOLERANCE_MM = 0.15


def _truth(name):
    return json.loads((SYNTH / f"{name}.truth.json").read_text(encoding="utf-8"))


def _extract(name):
    from nutrivo_worker.extraction import extract_artwork
    return extract_artwork(SYNTH / f"{name}.pdf")


def _overlaps(a, b, slack=1.0):
    return a[0] < b[2] + slack and a[2] > b[0] - slack and a[1] < b[3] + slack and a[3] > b[1] - slack


@pytest.mark.milestone(3)
def test_be16_one_panel_row_per_printed_language_panel():
    result = _extract("clean_3lang")
    assert len(result.panels) == 3
    assert sorted(p.language for p in result.panels) == ["de", "en", "sv"]


@pytest.mark.milestone(3)
def test_be17_both_heights_on_every_text_object_within_tolerance():
    result = _extract("clean_3lang")
    objects = [o for p in result.panels for o in p.text_objects]
    assert objects and all(o.x_height_mm is not None and o.cap_height_mm is not None for o in objects)
    for t in _truth("clean_3lang")["text_objects_sample"]:
        matches = [o for o in objects if _overlaps(o.bbox_mm, t["bbox_mm"]) and t["text"][:4] in o.text]
        assert matches, f"no extracted text object for {t['key']!r}: {t['text']!r}"
        best = min(matches, key=lambda o: abs(o.cap_height_mm - t["cap_mm"]))
        assert abs(best.cap_height_mm - t["cap_mm"]) <= TOLERANCE_MM, (t["key"], best.cap_height_mm, t["cap_mm"])
        assert abs(best.x_height_mm - t["x_mm"]) <= TOLERANCE_MM, (t["key"], best.x_height_mm, t["x_mm"])


@pytest.mark.milestone(3)
def test_be18_partial_results_with_typed_failures():
    result = _extract("mixed_9panels")
    assert len(result.panels) == 9
    failed = sorted(p.index for p in result.panels if p.status == "not_assessable")
    assert failed == [2, 5, 7]
    assert all(p.failure_code == "outlined_text" for p in result.panels if p.status == "not_assessable")
    assert sum(1 for p in result.panels if p.status == "extracted") == 6


@pytest.mark.milestone(3)
def test_be18_outlined_and_rasterised_artwork_are_named_not_errors():
    outlined, raster = _extract("outlined_all"), _extract("rasterised")
    assert outlined.panels and all(p.status == "not_assessable" and p.failure_code == "outlined_text"
                                   for p in outlined.panels)
    assert raster.panels and all(p.status == "not_assessable" and p.failure_code == "rasterised"
                                 for p in raster.panels)
