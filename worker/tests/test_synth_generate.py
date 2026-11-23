"""Incident #312: the synthetic generator builds mixed_9panels with the installed pypdf (6.x and 7.x).

pypdf 7 removed merging onto a page that no writer owns, so the generator attaches the base page to its PdfWriter
first. This builds the one fixture that merges pages into a temporary folder and checks the merged page against
its own truth file. The fixtures in fixtures/synth/out are left untouched.
"""
import importlib.util
import json
import shutil
from pathlib import Path

import pypdf
import pytest

from nutrivo_worker.extraction import extract_artwork

ROOT = Path(__file__).resolve().parents[2]
GENERATE = ROOT / "fixtures" / "synth" / "generate.py"


def _generator():
    spec = importlib.util.spec_from_file_location("synth_generate", GENERATE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def mixed(tmp_path_factory):
    if not (shutil.which("gs") and shutil.which("pdftoppm")):
        pytest.skip("ghostscript and poppler are needed to outline panels")
    gen = _generator()
    font = next((p for p in gen.FONT_PATHS if p.exists()), None)
    if font is None:
        pytest.skip("DejaVu Sans not installed")
    gen.pdfmetrics.registerFont(gen.TTFont("Body", str(font)))
    out = tmp_path_factory.mktemp("synth")
    [spec] = [s for s in gen.FIXTURES if s["post"] == "mixed"]
    gen.build(spec, gen.Metrics(font), out)
    return out / f'{spec["name"]}.pdf', json.loads((out / f'{spec["name"]}.truth.json').read_text(encoding="utf-8"))


def test_the_merged_fixture_is_one_page_with_every_panel(mixed):
    pdf, _ = mixed
    assert len(pypdf.PdfReader(str(pdf)).pages) == 1, f"pypdf {pypdf.__version__}"


def test_the_merged_fixture_extracts_as_its_truth_says(mixed):
    pdf, truth = mixed
    result = extract_artwork(pdf)
    got = {p.index: (p.status, p.failure_code) for p in result.panels}
    want = {p["index"]: (p["expected_status"], p["expected_failure"]) for p in truth["panels"]}
    assert got == want
    assert result.status == "partial" and result.failure_codes == ["outlined_text"]
    by_index = {p.index: p for p in result.panels}
    for p in truth["panels"]:
        if p["expected_status"] == "extracted":
            assert [o.text for o in by_index[p["index"]].text_objects] == [t["text"] for t in p["text_objects"]]
