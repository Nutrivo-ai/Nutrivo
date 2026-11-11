# 20 · Frontend: every designed screen, built and working

The goal: every screen in design/ becomes a working route, visually matching its design (1600 px desktop, 390 px for
the Mobile file), wired to real data, with loading, empty, error and no-permission states, and no control that does
nothing.

## 1 · The design files (T-006)
- **Manifest.** `design/MANIFEST.json` lists all 43 files of the Drive folder with their Drive ids and exact sizes:
  - 29 `.dc.html` design files;
  - the copies of `support.js` and `doc-page.js` each folder needs;
  - the `_ds` bundle.
- **Fetch and verify.** `make design-fetch` downloads them and `make design-check` verifies every file by size.
  The design files are never edited.

## 2 · Screen inventory and baselines (T-012, frozen at gate G4)
- **What Claude Code reads.** Every design file, including the 302 KB `product/Nutrivo 2.0.dc.html`, whose left rail
  switches between its 34 screens.
- **What it writes to spec/screens.yaml,** one entry per screen:
  - id, title, design file and the state or frame that shows it;
  - route, required role;
  - workflows;
  - data (tables, views, RPCs);
  - states;
  - viewports.
- **Baselines.** A Playwright script opens each design file locally, switches it to each screen and saves a
  screenshot to `apps/web/tests/visual/baselines/<id>.png`.
  - `pnpm --dir apps/web baselines` (`playwright.baselines.config.ts`) serves design/ over HTTP and sets the design's
    own component state recorded in the entry's `state` (what its rail, tab or step sets).
  - It saves a full page at 1600 px, or for the Mobile file's phones the phone element (`element`).
  - Re-run it only when design/ or the inventory changes.
- **Guard.** `apps/web/src/lib/screens/inventory.test.ts` (in `pnpm test`) checks the inventory against design/:
  - every frame a design file switches to is inventoried exactly once;
  - every design file in product/, public/ and documents/ is covered;
  - every workflow id exists and every baseline is present.
- **What T-012 found** (104 screens):
  - Nutrivo 2.0, 34;
  - Missing Surfaces 5, Onboarding 8, Plans and Checkout 6, Workspace Settings 6, Billing Settings 4,
    Account Recovery 5, Partner Tier 4, Partner Upsell 2, Mobile 6, Empty and Error States 1;
  - 16 public frames, 6 emails, 3 documents.
- **Recorded as proposals.** Routes and roles are not written down elsewhere, so they are proposals. They are listed
  with the other open questions (Q1 to Q5 in the file's header) for G4.
- **Gate G4.** The founders approve the inventory; from then on it is the frontend's target.

## 3 · Demo data identical to the design (T-013)
The mock data inside the design files' component scripts (Halden Pet Nutrition: its people, recipes, markets, artwork,
suppliers and documents) is extracted into one synthetic workspace. The loader and the full list are in
`supabase/seed/demo/` (README.md and `load.sh`). The SQL is `supabase/tests/app/fixtures/demo_halden.psql`, so the pgTAP
container can test it. The seed is loaded into local, CI and the staging demo workspace (T-010), never production. It
makes each built screen directly comparable with its baseline, with one deliberate exception: verdicts. No ruleset is
encoded yet, so every demo check and finding is withheld with its coverage gap (no rule, no verdict). Screens show Not
assessed where the design draws Clear, Action or Blocked, until real checks run against accepted rules (question on
issue #22). `make db-reset` does not load it, because the gate tests assume an empty tenant dataset.

## 4 · Building screens
- **Order.** Tokens and the component kit come first (T-101); then the shell and routing (T-102); then each screen
  inside the task that owns its workflows.
- **Visual check.** Each screen's Playwright visual test compares the route, rendered with demo data, against its
  baseline (`maxDiffPixelRatio` from spec/nfr.yaml, 2%). The PR shows the diff image.
- **Interaction.** A no-dead-controls test clicks every button and link on each screen in the demo workspace. It
  expects a navigation, a dialog, a request or a visible state change, and no console error, failed request or
  unhandled rejection.
- **Accessibility.** axe-core runs on every route (zero serious or critical findings), with keyboard tests for the
  main flows. From T-1104 the bar is WCAG 2.2 AA (below).

## 5 · Everything else in the designs
| Design file | Built as | Task |
|---|---|---|
| Landing Page, Pricing Page, Coverage - public, FAQ and About, Segment Pages, Legal, Marketing Site | Statically rendered marketing routes; coverage from `public.coverage_snapshot()`; invented claims removed (D-19) | T-603 |
| Email Templates | Worker HTML templates (Jinja2), with snapshot tests of rendered previews | T-105, T-602 |
| Export - Label Report, Certificate of Check, Action Plan | WeasyPrint templates; each PDF page rendered to PNG and compared with its design baseline | T-405 |
| Mobile | Responsive routes at 390 px: verdict reading, pack photo, alerts | T-507, T-902 |
| Empty and Error States | The shared EmptyState and ErrorState components used by every screen | T-101 |
| Account Recovery, Onboarding Flow | Auth and onboarding routes | T-103, T-106 |
| Workspace Settings, Plans and Checkout, Billing Settings | Settings and billing routes | T-107, T-108, T-703 |
| Partner Tier, Partner Upsell | After launch (N01, N03) | — |

### Built in T-1003: promote a brief to artwork (`apps/web/src/components/briefs/PromoteToArtwork.tsx`)
- **S-NV2-004 Brief & formula** gains **Promote to artwork**, an outline button under the intended claims, shown only at
  stage brief. It calls C04's `app.set_product_stage` to `in_development` (E04 step 1) and opens Upload & scope (S-NV2-002)
  for the same product (step 2, D01). It has pending ("Promoting…") and refused states (role, not found, error), and
  failures go to Sentry tagged `area: briefs`, `briefs_step: promote_brief` with the request id. The design has no
  promote control, so its placement and wording are the default proposed on #78 (Q1).
- **Tests** (`tests/e2e/briefs.spec.ts`): E04.main, a viewer's no-permission state with no control and the database's
  42501, axe, and the screen's first no-dead-controls crawl (Paste, Add a line, Save claims, Promote to artwork).

### Built in T-507: the mobile reading views (`apps/web/src/components/mobile`)
- **S-MOB-003 The verdict** at `/w/[workspace]/products/[product]/nodes/[node]`, in the phone's three blocks: the state
  with its glyph, *What to do* with one link (the registration pack, the label report, the coverage gap or Upload &
  scope), and *Where this came from* (provenance with the rule or gap, and the pinned ruleset and artwork hash). A
  parent node names the child that sets its roll-up. It renders at every width; the desktop Product × node layout
  (S-NV2-007) is T-504's.
- **S-MOB-004 Capture** at `/w/[workspace]/capture`: the framing guidance and what a photograph is for, and a statement
  that capture is not available yet. No endpoint takes a pack photo, so it has no Capture control (#57 question 1).
  S-MOB-005 Read back waits for the same answer.
- **Tests** (`tests/e2e/mobile.spec.ts`, at 390 px): every state, axe, 44 px targets, no horizontal scroll, the
  no-dead-controls crawl, and the width-independent regions of the S-MOB-003 and S-MOB-004 baselines (the state label,
  kickers and the capture title) until spec/screens.yaml Q2 settles how a 390 px route compares with a 284 px phone.

### Built in T-506: the board (`apps/web/src/components/board`, `apps/web/src/lib/board`)
- **S-NV2-006 Board** at `/w/[workspace]/board`: the stat tiles (answers unproven, stale against ruleset), the filter
  chips (links, so filters live in the URL), products × markets grouped by region with each region's roll-up cell from
  `app.rollup_state`, the ruleset each row was judged against, and the legend. `?view=findings` lists the open findings
  across the portfolio (F04). Empty: "Add a product". An empty workspace keeps the screen title "Board".
- **Not built** (#56): the "Obligations with a date" tile, S-MOB-001 at 390 px and the 300-recipe budget (both need a
  set-returning roll-up in the database), S-MIS-003's search and saved views (F02, LATER).
- **Tests** (`tests/e2e/board.spec.ts`): F01.main, F01.must.1, F04.main, the empty state, axe, the screen's links and
  no buttons, and the legend against the S-NV2-006 baseline.

### Built in T-1104: WCAG 2.2 AA across apps/web (`tests/e2e/a11y.spec.ts`, `tests/e2e/keyboard.spec.ts`)
- **The sweep.** Every route in `src/app/**/page.tsx` is opened signed out, as a workspace admin with a product in four
  markets, in a workspace with no products, as a viewer, and from outside the workspace, plus /admin for a person
  who is not staff. Each passes axe with the WCAG 2.0, 2.1 and 2.2 A and AA rules at any impact (and no serious or
  critical best-practice finding), has a title of its own and a skip link to its one `<main id="main">`. Workspace
  routes reflow at 320 px. The checks are in `tests/e2e/support/a11y.ts`.
- **Keyboard.** The skip link is the first stop and moves the next Tab into `<main>`; the rail is in reading order
  with the current section marked; on fourteen main screens every control in `<main>` is reached by Tab, focus is
  always visible and not hidden behind other content, and never trapped; the stage radio cards move with the arrows
  and show focus; the phone's More dialog keeps focus and returns it to More on Escape; sign-in runs on the keyboard
  alone and keeps the email after a refused attempt (3.3.7).
- **Fixed.** Page titles on 45 routes (they all read "Nutrivo"); the skip link; an in-text link told apart by colour
  alone (artwork in progress); focus on the hidden stage radios and an invisible file-input stop (Add a product);
  table scrollers that let `sr-only` text widen the page at 320 px (board, people, audit log, coverage, DataTable);
  the sign-in email cleared after a refused attempt; a header landmark on /admin's staff-only page.
- **Open (#82, needs-human).** The public marketing routes are drawn at a fixed 1280 px (design/public), so they
  scroll sideways below that width and do not meet 1.4.10 Reflow; making them reflow needs a narrow-screen design.
  Unknown URLs show Next's default 404, which has no `<main>` and none of the site's chrome; no design draws a 404.

## 6 · Performance
Lighthouse budgets on the public pages (LCP under 2.5 s); a 1.5 s budget for the board with 300 recipes
(spec/nfr.yaml).
