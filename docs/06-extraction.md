# 06 · Artwork extraction

The hardest single item (Handoff cluster D). Vector text, fonts, coordinates and glyph metrics per language panel,
with a typed failure taxonomy and partial results.

## Contract (the gate tests in worker/tests/gates/ depend on it)
```python
from nutrivo_worker.extraction import extract_artwork
result = extract_artwork(path)            # ExtractionResult

ExtractionResult: file_sha256, idempotency_key, page_size_mm: list[tuple[float, float]], panels: list[Panel],
                  engine: str, engine_version: str; .status ('succeeded'|'partial'|'failed'), .failure_codes
Panel:      index, page, bbox_mm, language, language_confidence,
            status ('extracted' | 'not_assessable'), failure_code, text_objects: list[TextObject]
TextObject: text, bbox_mm, font_name, font_size_pt, x_height_mm, cap_height_mm, is_ocr, confidence,
            height_source ('os2' | 'outline' | 'glyph_box')
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
pypdfium2 (BSD-3 / Apache-2.0) for characters, glyph boxes, page objects and glyph outlines · fontTools (MIT) for
OS/2 heights from font programmes · lingua (Apache-2.0). pdfplumber (MIT) is a development-only cross-check in the uv
`dev` group (D-15) and never runs in production code; a test keeps it out of `worker/src`. **No PyMuPDF** (AGPL-3.0 or a commercial Artifex
licence) unless the licence is bought (D-15). OCR geometry is out of scope at launch.

## Budget
Under 20 s and under 1 GB of memory for a 10-page print PDF on the worker.

## Spike results
Pre-filled on 8 Oct 2026: on the synthetic clean_3lang label, pypdfium2 tight character boxes measure the
net-quantity digits at 6.09–6.20 mm against a ground truth of 6.2 mm (figure height) and 6.09 mm (cap height).
### T-301: pypdfium2 against pdfplumber (23 Oct 2026)
pypdfium2 5.14.0 (PDFium 156.0.8076.0), pdfplumber 0.11.10 (pdfminer.six 20260107), fontTools 4.66.1, on the six
synthetic fixtures. Reproduce with `cd worker && uv run python spikes/extraction_compare.py` (`--json` for every
line); `worker/tests/test_extraction_spike.py` keeps the numbers below true.

Each cell reads *within ±0.15 mm / lines measured, of lines on the page · worst error in mm*. A line is measured by a
glyph-box method only when it holds a glyph that method reads (box cap: a flat capital such as H, E, T; box x: v, w, x,
y, z; box figure: a digit), all read from the character's baseline origin. Font cap and font x come from the embedded
font programme's outlines of 'H' and 'x', times font size and text-matrix scale. x-extent compares the line's first
and last character edges with the truth bbox.

| Fixture | Library | Lines | x-extent | Box cap | Box x | Box figure | Font cap | Font x | Panels as expected |
|---|---|---|---|---|---|---|---|---|---|
| clean_3lang | pypdfium2 | 57/57 | 57/57 · 0.081 | 39/39 of 57 · 0.000 | 21/21 of 57 · 0.001 | 36/36 · 0.110 | 57/57 · 0.000 | 57/57 · 0.000 | 3/3 |
| clean_3lang | pdfplumber | 57/57 | 57/57 · 0.001 | n/a | n/a | n/a | 57/57 · 0.000 | 57/57 · 0.000 | 3/3 |
| missing_batch | pypdfium2 | 56/56 | 56/56 · 0.081 | 38/38 of 56 · 0.000 | 21/21 of 56 · 0.001 | 35/35 · 0.110 | 56/56 · 0.000 | 56/56 · 0.000 | 3/3 |
| missing_batch | pdfplumber | 56/56 | 56/56 · 0.001 | n/a | n/a | n/a | 56/56 · 0.000 | 56/56 · 0.000 | 3/3 |
| small_netqty | pypdfium2 | 19/19 | 19/19 · 0.081 | 13/13 of 19 · 0.000 | 6/6 of 19 · 0.001 | 12/12 · 0.071 | 19/19 · 0.000 | 19/19 · 0.000 | 1/1 |
| small_netqty | pdfplumber | 19/19 | 19/19 · 0.000 | n/a | n/a | n/a | 19/19 · 0.000 | 19/19 · 0.000 | 1/1 |
| outlined_all | both | no text | – | – | – | – | – | – | 3/3 outlined_text |
| rasterised | both | no text | – | – | – | – | – | – | 3/3 rasterised |
| mixed_9panels | pypdfium2 | 114/114 | 114/114 · 0.083 | 78/78 of 114 · 0.000 | 49/49 of 114 · 0.001 | 72/72 · 0.110 | 114/114 · 0.000 | 114/114 · 0.000 | 9/9 |
| mixed_9panels | pdfplumber | 114/114 | 114/114 · 0.001 | n/a | n/a | n/a | 114/114 · 0.000 | 114/114 · 0.000 | 9/9 |

Budget, on a 10-page document built from the fixture pages, each library in its own process (peak RSS is the
process's VmHWM): pypdfium2 0.12 s and 30 MB for tight boxes on every character plus every page object;
pdfplumber 3.3–3.6 s and 72 MB for characters, curves, rects and images. Both are well inside 20 s and 1 GB.

**Findings**
1. **Glyph boxes.** pypdfium2's tight character boxes (`get_charbox(loose=False)`) with the character origin
   (`FPDFText_GetCharOrigin`) give cap height and x-height to 0.001 mm and figure height to 0.11 mm. pdfplumber has
   no tight glyph box: its character box is the font-size box (`bottom - top == size`), so it cannot cross-check
   heights. Its x-extent is closer to the truth (0.001 against 0.08 mm) only because both use advance widths; the
   0.08 mm is side bearing in pdfium's loose box, and doesn't affect height measurement.
2. **Font programmes.** Both reach the embedded programme. On these fixtures the subset (ReportLab, `AAAAAA+DejaVuSans`)
   has **OS/2 version 1 with no sxHeight or sCapHeight and no Unicode cmap**, so the outline fallback always fires.
   - pypdfium2 maps Unicode to the glyph itself (`FPDFFont_GetGlyphPath`). The path is in **em units whatever
     `font_size` you pass**, so scale it by size and matrix yourself. It returns None for a glyph the subset lacks,
     with no system-font substitution.
   - With pdfplumber the same needs ToUnicode → PDF code → the subset's (1,0) cmap → glyph name → fontTools
     BoundsPen.
   - `FPDFFont_GetFontData` hands fontTools the same bytes when OS/2 heights are wanted.
   - The FontDescriptor's `CapHeight` (759.8) is just `Ascent` copied, so never use it.
   - The 0.000 font errors are partly circular, because the generator derives truth from the same DejaVu outlines.
     The glyph-box agreement is the independent check.
3. **Failure signals.** Both see text, vector paths and images per panel region and classify all 22 fixture panels
   correctly, provided the classification takes the **dominant** signal rather than "any text".
4. **Fixture layout** (fixed in T-302: every line now wraps, and `gutter_overflow` crosses a gutter on purpose). The operator line ("Nordic Pet Foods AB, …") is never wrapped. It runs about 9 mm past its
   panel and across the 6 mm gutter into the next panel. On the right-hand panels it runs off the page (x1 237.2 mm on
   a 234 mm page). Outlined panels 2, 5 and 7 of mixed_9panels therefore hold 2–3 stray characters, and a pure
   whitespace-gutter clustering would merge neighbouring panels on that row. T-302's panel clustering must tolerate
   this, or the generator must wrap the line (asked on issue #39).
5. **Limits.** One font, one producer (ReportLab, then Ghostscript for outlining), identity text matrices, no rotation
   and no Type 0/CFF fonts. The founder review in M3 with real print PDFs is still the test that counts.

**Choice for T-302:** pypdfium2 as the extraction engine, for characters, tight boxes, origins, text and page objects,
failure signals and glyph outlines. Add fontTools on `FPDFFont_GetFontData` only to read OS/2 heights when the
programme carries them, and cross-check them against the tight boxes. pdfplumber adds nothing pypdfium2 lacks here
and is about 30 times slower. The founder decision on #39 made it development-only (D-15); T-302 moved it.

## Implementation (T-302)
`worker/src/nutrivo_worker/extraction/`: `engine.py` (pypdfium2), `fonts.py` (heights), `layout.py` (panels),
`language.py` (lingua), `types.py` (the contract). Persisting the result and the `extract` job are T-303's.

- **Text objects.** pypdfium2 characters, in content order, form one text object per line. A line breaks on a change
  of font, size or baseline, or on a jump back or across a gap wider than one em. Generated characters are skipped,
  and so is invisible text (render mode 3, an OCR layer). The bbox is the union of the loose character boxes.
  Lines follow each character's own baseline direction from the character matrix (text matrix times CTM), so text
  at 90° or 180° groups as it reads. `font_size_pt` is the effective size: the font size times the matrix's scale
  perpendicular to the baseline, |ad − bc| / hypot(a, b). Placement scaling and shear are measured, not
  overstated. A glyph's top is measured perpendicular to the baseline.
- **Heights.** These come from the embedded programme. OS/2 `sCapHeight`/`sxHeight` are used when the table is
  version 2 or later and both are set. Otherwise the code takes the top of the first flat reference glyph the
  programme has: H E I T L F B D K N P R U Z for cap height, x z v w y for x-height. Either value is scaled by the
  effective size. The line's own tight glyph boxes are the cross-check, which sets `confidence`:
  - 1.0 when every check is within ±0.15 mm;
  - 0.5 when one disagrees;
  - 0.8 when the line holds no flat glyph to check.
  If the programme has neither value, the measured tops of that font's flat glyphs elsewhere on the page are used
  (`height_source` 'glyph_box', confidence 0.8). If even those are missing, the panel is `missing_font`.
- **Panels.** Clustering is a recursive XY-cut over text lines, filled or stroked paths and images, and it cuts rows
  before columns, so indices run row-major across pages. A gutter is at least 4 mm wide, with content wholly on both
  sides.
  - Between columns, at most two text lines may cross a gutter. A crossing line belongs to the panel it starts in,
    and it does not widen that panel's bbox (the `gutter_overflow` fixture).
  - Between rows, the band must be clear.
  - Only what overlaps the TrimBox (else the CropBox) counts. Crop marks and the slug lie outside it, are cut off in
    print and are left out.
  - The outer edges are open, so content bleeding past the page still belongs to its panel. Panel boxes are clamped
    to the page.
  - An object covering 90% or more of the page in both directions counts as background. It is left out of the cut
    and is part of every panel it overlaps.
- **Status.** The dominant signal decides: characters against path objects against images (the T-301 rule).
  An extracted panel whose text uses a font that is not embedded, or that has no measurable heights, becomes
  `missing_font`. A substituted system font is never measured. Not-assessable panels carry no text objects.
- **Unreadable.** A file pdfium cannot open becomes one panel: page 0, bbox `[0, 0, 0, 0]` (no geometry), and
  `unreadable`. A page pdfium cannot load or parse becomes one `unreadable` panel spanning that page. Its size comes
  from `FPDF_GetPageSizeByIndexF`, or `[0, 0]` when even that fails. The exception goes to Sentry, and the other pages
  carry on. Neither case raises.
- **Not raised yet.**
  - `no_true_scale` is not raised for PDFs, since a PDF page carries its physical size. It applies to photo uploads
    (T-303).
  - `colour_space` is not raised either, because the engine renders nothing.
- **Language.** lingua runs on the panel's text. The candidates are the EU and EEA official languages lingua knows
  (all but Maltese, plus Bokmål, Nynorsk and Icelandic). The result is `und` below 20 letters or below 0.5
  confidence.
- **Idempotency.** The output is deterministic. `idempotency_key` is `extract:<sha256>:<hash of engine_version>`, so
  the same bytes through the same engine and library versions give the same key, whatever the file name.
- **Observability.**
  - One Sentry span (`op=extraction`) carries the file hash, pages, panels and failure codes.
  - One log line carries the same.
  - Never label text.
- **Budget.** 10 pages from the fixtures take about 0.5 s and 170 MB peak RSS, most of it loading lingua. A test keeps this
  under 20 s and 1 GB.
- **Known limits.**
  - Any whitespace-separated block becomes a panel, including a lone logo or a two-column table. The triage view
    (D02) corrects these.
  - Objects inside form XObjects are taken with pdfium's bounds.
  - The real-artwork review in M3 is still the test that counts.
