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

### Built in T-101 (`apps/web/src/components/kit`, imported from `@/components/kit`)
- **Tokens.** The block above is copied verbatim into `apps/web/src/styles/tokens.css`.
  - `globals.css` maps it into Tailwind after clearing Tailwind's default palette, fonts, radii and shadows.
  - The only colour classes are the tokens: `text-ink`, `bg-panel`, `border-rule`, `text-accent-700`, `text-n600`, …
    and `text-clear`, `text-action`, `text-na`, `text-blocked` with their `-bg` tints. Not assessed is `na` because
    Tailwind already has `border-none` and `bg-none`.
  - `tokens.test.ts` compares the file with this block and fails on a colour defined anywhere else in `src/`.
  - Both fonts are self-hosted through `next/font`, so the browser never contacts a font service.
- **Base styles.** There is no Tailwind preflight. The app renders on the design set's own base
  (`design/_ds/…/styles.css`: border-box sizing, body 15px/1.55, `p` and heading margins), so components match
  design/ pixel for pixel.
- **States.**
  - `StateGlyph` and `StateBadge` draw the specification's glyphs at 12 px (`md`) and the board's at 9 px (`sm`). A
    badge always shows the glyph and the name.
  - `StateCell` and `stateTint` make the board cells; `StateLegend` is the legend under the board.
- **Findings.**
  - `ProvenanceTag`: mono, neutral `--n600`, never tinted.
  - `CitationLink`: needs a `ruleKey`.
  - `GapLink`: needs a `gapId` and the coverage href.
  - `Finding`: the label-report row. Its type requires provenance. A Not assessed finding requires `reasonCode`,
    `gapId` and `gapHref`. A finding with a verdict requires `ruleKey` and a citation, and is never Clear.
- **Frames and controls.** `Panel`, `Blueprint` (the ink frame with registration marks), `SectionHeading`, and
  `Button` and `ButtonLink` (primary, secondary, ghost).
- **Tables.** `DataTable` renders loading, error, no permission and empty in place of its rows, in that order.
- **Empty, error and loading.** `EmptyState` (kinds none and action), `ErrorState`, `NoPermissionState` and
  `LoadingState` (neutral, mono).
  - Each is built from the four parts of the Empty and Error States file: a mark, what is true, one action, and a
    reference.
  - The marks (`PatternMark`) are that file's own marks, never the verdict glyphs.
- **Dialog and Toast.** `Dialog` uses the native `<dialog>`; `Toast` uses `ToastProvider` and `useToast`. No design
  file draws either, so both are built only from the §5 primitives of the Cobalt specification. This is an open
  question on issue #23.
- **Deviations from the design, recorded on #23.**
  - Small text drawn in `--n500` is set in `--n600`, so axe finds no contrast failures (spec/nfr.yaml).
  - Finding rows in Nutrivo 2.0 tint provenance with verdict colours. The kit follows Cobalt §6 rule 3 and keeps
    provenance neutral.
- **Test pages.** `/kit` shows every component in every state; `/kit/empty-and-error-states` is S-EES-001 rebuilt
  from the kit. Both return 404 when `NUTRIVO_ENV=prod`.
  - `tests/e2e/kit.spec.ts` compares S-EES-001 with its design baseline, and the gallery sections and the dialog
    with their own images in `tests/visual/kit/`, all within spec/nfr.yaml's 2% (`--update-snapshots` rewrites
    the kit's images only).
  - It also runs axe on both pages and checks the dialog by keyboard.
  - Both Playwright configs launch Chromium with `tests/visual/render.ts`: no font hinting, greyscale antialiasing
    and an sRGB profile. The design baselines were captured with exactly these flags, and without them a stock
    ubuntu runner draws hinted, subpixel text that differs from the baselines by 3–4%.
- **Left to the screen tasks.** The Shell with left rail, LanguageSwitcher and RegionTree go to T-102 and the screens
  that use them; ArtworkViewer goes to T-404.
