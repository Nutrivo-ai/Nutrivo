# 06 · Artwork extraction

The hardest single item (Handoff cluster D). Vector text, fonts, coordinates and glyph metrics per language panel,
with a typed failure taxonomy and partial results.

## Contract (the gate tests in worker/tests/gates/ depend on it)
```python
from nutrivo_worker.extraction import extract_artwork
result = extract_artwork(path)            # ExtractionResult

ExtractionResult: page_size_mm: list[tuple[float, float]], panels: list[Panel], engine: str, engine_version: str
Panel:      index, page, bbox_mm, language, language_confidence,
            status ('extracted' | 'not_assessable'), failure_code, text_objects: list[TextObject]
TextObject: text, bbox_mm, font_name, font_size_pt, x_height_mm, cap_height_mm, is_ocr, confidence
```
Coordinates are millimetres from the **top-left** of the page: `[x0, y0, x1, y1]`. Persisted to
`app.extraction_runs`, `app.artwork_panels` and `app.text_objects`.

## Measuring heights (BE-17: both, always)
x-height and cap-height come from the embedded font programme (fontTools on the font stream: OS/2 sxHeight and
sCapHeight where present, otherwise the outlines of 'x' and 'H'), scaled by font size and the text matrix, then
converted to mm. Cross-check against tight glyph boxes from pypdfium2 where the glyphs are on the page. Figure
height (for net quantity) is the tallest digit actually printed. Tolerance on the synthetic set: ±0.15 mm.
A measurement is only real when the page has true physical scale; otherwise the panel is not_assessable with
`no_true_scale`. Geometry is never estimated.

## Panels and languages
Cluster text blocks into panels using whitespace gutters, and dielines or crop marks where present. One panel per
printed language block. Language per panel with lingua on the panel's text (fallback `und` when too short).
A person can correct a language or mark a panel not assessable in the triage view (D02).

## Failure taxonomy (BE-18: per panel, successful panels persist)
| Code | Detected when |
|---|---|
| outlined_text | Vector paths where text would be, and no text objects in the region |
| rasterised | Images cover the region and there is no text |
| missing_font | Text objects without an embedded font programme, so heights cannot be measured |
| colour_space | An unsupported colour space prevents rendering for cross-checks |
| no_true_scale | No physical scale (photos, raster-only, unknown placement scaling) |
| unreadable | Corrupt or encrypted file, or a page that cannot be parsed |

## Libraries (licences verified on PyPI, 8 Oct 2026)
pypdfium2 (BSD-3 / Apache-2.0) for glyph boxes and rendering · pdfplumber (MIT) for characters, fonts and layout ·
fontTools (MIT) for font programmes · lingua (Apache-2.0). **No PyMuPDF** (AGPL-3.0 or a commercial Artifex
licence) unless the licence is bought (D-15). OCR geometry is out of scope at launch.

## Budget
Under 20 s and under 1 GB of memory for a 10-page print PDF on the worker.

## Spike results
Pre-filled on 8 Oct 2026: on the synthetic clean_3lang label, pypdfium2 tight character boxes measure the
net-quantity digits at 6.09–6.20 mm against a ground truth of 6.2 mm (figure height) and 6.09 mm (cap height).
Milestone 3 adds its comparison of pypdfium2 and pdfplumber here before choosing.
