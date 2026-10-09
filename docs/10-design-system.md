# 10 · Design system (Cobalt)

## Tokens (verified in the design files)
```css
--ink: #101216; --paper: #ffffff; --rule: #dde0e6; --panel: #f4f5f7;
--accent: #2f5eff; --accent-100: #eef2ff; --accent-200: #d8e2ff; --accent-600: #1f49d9; --accent-700: #1738a8;
--n200: #eef0f2; --n300: #dde0e6; --n400: #c3c8d0; --n500: #8b9098; --n600: #6b7178; --n700: #42464c; --n800: #26292e;
--clear: #0f7a4d;  --clear-bg: #e6f2ec;     /* Clear */
--action: #9e5600; --action-bg: #fdf0dd;    /* Action */
--none: #5f6570;   --none-bg: #f1f2f4;      /* Not assessed */
--blocked: #b3251f; --blocked-bg: #fbe8e7;  /* Blocked */
--head: 'Instrument Sans', system-ui, sans-serif;   /* 400 500 600 700 */
--mono: 'IBM Plex Mono', ui-monospace, monospace;   /* 400 500 */
```
Self-host both fonts with `next/font`. Headings use letter-spacing −0.03em.

## The verdict vocabulary
Four states, each with its own glyph, defined in `Nutrivo Brand - Cobalt Specification.dc.html` (extract the glyphs
in milestone 1). A state is never shown by colour alone, and the accent never reads as a verdict: follow the
specification's three rules on this exactly.

## Which design file wins (Handoff §06)
| File | Authoritative for |
|---|---|
| Nutrivo 2.0.dc.html | Every in-product surface (34 screens), states, findings, registration packs, the Worker panel |
| Nutrivo - Missing Surfaces.dc.html | Alerts inbox, horizon, board at portfolio scale, bulk re-check, help |
| Nutrivo - Gap Register.dc.html | Scope: undrawn surfaces, placeholders, open decisions |
| Nutrivo - Full Coverage Requirements.dc.html | What makes each coverage claim true |
| Nutrivo Pricing - Priced Ladder.dc.html | Prices and dials (its Free row is stale) |
| Nutrivo Workspace Settings.dc.html | Permission model, retention per record kind, audit log content |
| Nutrivo Brand - Cobalt Specification.dc.html | Tokens, state values and glyphs |
| Nutrivo Legal - Terms, DPA, Privacy.dc.html | Contractual promises (drafts pending counsel) |

## Layout
Desktop designs at 1600 px; document pages have a minimum width of 1120 px; phone layouts for reading results;
tablet is the desktop layout reflowed. Interface in English.

## Component kit (milestone 1)
StateBadge (four states with glyphs) · ProvenanceTag · CitationLink · GapLink · Panel · DataTable · ArtworkViewer
with pins and measured-versus-required labels · LanguageSwitcher · RegionTree · Shell with left rail · Dialog ·
Toast · EmptyState and ErrorState (from the Empty and Error States file).
