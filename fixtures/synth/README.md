# Synthetic labels

`make fixtures` writes seven print-accurate PDFs and their `*.truth.json` to `fixtures/synth/out/` (git-ignored):
clean_3lang, missing_batch, small_netqty, outlined_all, rasterised, mixed_9panels, gutter_overflow.
Every line wraps inside its panel, except the one line in gutter_overflow that crosses the gutter on purpose; its
truth file names the panel it belongs to (`expected_attribution`, #39). Every page is drawn at true
physical size, so character heights in the truth files are exact (millimetres, origin top-left).
Verified 8 Oct 2026: pypdfium2 measures the clean label's net-quantity digits at 6.09–6.20 mm against 6.2 mm.
The wording in `terms.json` is fixture text, not regulatory content. Needs ghostscript and poppler on PATH.
