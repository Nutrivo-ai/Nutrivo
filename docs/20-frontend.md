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
- **Launch scope (25 Nov 2026, abnutrivo, after the launch audit on #85).** Five screens that were still placeholders
  move to `scope: later`: Certificates (S-NV2-009), Ingredients & formulas (S-NV2-011), Term register (S-NV2-012),
  Monitoring & alerts (S-NV2-015) and Jurisdiction tree (S-NV2-019). Their routes and rail entries are removed, so no
  customer reaches a placeholder; their designs and baselines stay for when they are built. Five others are built
  before launch as T-1108 to T-1112: Home, the product page, Settings overview, Check in progress and Exports.

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

### Built in T-1002: the compliance envelope (`apps/web/src/components/briefs/Envelope.tsx`)
- **S-NV2-005 Design envelope** at `/w/[workspace]/briefs/[product]/envelope`, built to the design:
  - three cards (Clear as briefed, Action needed, Not assessed) listing the markets in each;
  - "The envelope": each additive of the brief with its register ceiling per market, or N/A where withheld;
  - "Wording you can use": the term register's own wording per language, with citation and provenance;
  - "Not assessed": every withheld item with its reason and its gap, linked to the coverage node, or "no coverage gap
    recorded";
  - the out-of-scope statement for nutrient adequacy, and the pinned ruleset.
- **States.** Loading, empty (never screened), screening (the job over Realtime, `EnvelopeProgress`), error (read or
  failed job), not found, and a refusal under the button (no permission, no ruleset, no markets).
- **Not built.** The design's "Next actions" and "What to do" column are proposals (E03, LATER), so "Not assessed" takes
  their place (#77 default 4). The "What we can answer with this" panel on S-NV2-004 is not built either: its lines
  would be answers the envelope has not given.
- **S-NV2-004 Brief & formula** gains **Screen this brief** at stage brief (`ScreenThisBrief.tsx`): `app.request_envelope`,
  then Design envelope.
- **Tests** (`tests/e2e/envelope.spec.ts`): E02.main through the worker, E02.must.1 on every section, axe, the
  no-dead-controls crawl, and "The envelope" heading row against the S-NV2-005 baseline.

### Built in T-902: the alerts inbox and the horizon (`apps/web/src/components/alerts`, `apps/web/src/lib/alerts`)
- **S-MIS-001 Alerts inbox** and **S-MOB-006 Alerts** at `/w/[workspace]/alerts`: the desktop layout from `md` up and
  the phone's blocks below it. There is one card per rule change, from `app.alerts` (T-901) under RLS. Each card shows:
  - coming or in force, with its date;
  - the recipes whose latest check used the rule;
  - the rule's title and accepted citation;
  - a sentence composed only from the stored effect type and dates.

  Unread state is the person's own `app.alert_reads`, and **Mark all read** calls `app.mark_alerts_read` in batches of
  500. A press that fails part way says how many alerts it marked. Filters (`?show=in_force|coming`) and one change
  (`?diff=`) live in the URL, and the phone has the same controls with 44 px targets. The unread count always covers
  every change, whatever the filter shows. On the phone, **Open the first** goes to the first unread change's first
  finding.
- **J04.must.1, the plan gate** (`apps/web/src/lib/plan/regions.ts`). A finding in a market whose region is not in
  `app.workspaces.entitled_regions` is neither read nor shown:
  - the inbox names the recipe without a link;
  - the verdict (S-MOB-003) shows "Your plan does not include …", including at a direct URL;
  - the label report (S-NV2-003) and the board's findings view (F04) leave those markets out and say so.
  - the artwork page (S-NV2-025) leaves those markets' checks out of its panel states and reason codes;
  - the design envelope (S-NV2-005) leaves those markets' state, ceilings, wording and withheld items out and names
    them (incident: the envelope read them all).

  The database's RLS does not apply this, and neither do the worker's report PDFs; both are on #73. E2E fixtures that
  sell in the US now give their workspace the US region, as the product RPCs require.
- **S-MIS-002 Horizon** at `/w/[workspace]/horizon`. The nearest withdrawn-authorisation deadline leads, with its days
  left and **Open the two recipes** (the inbox for that change). Below it, in date order:
  - each coming change and each sell-through end, with its recipe count;
  - the `ref.horizon_items` not yet in force, with their stage. A draft has no countdown (BE-37).
- **Not built** (#73, `needs-human`):
  - the inbox's Draft cards and the horizon items' markets and recipe counts (horizon items are not linked to rules or
    recipes);
  - "What we watch ahead of law" (`ref.sources` is staff-only, and its content is not ours to write);
  - the Documents tab (H04 data);
  - "See the instrument" (no source link is readable).

- **Tests:**
  - `tests/e2e/alerts.spec.ts`: J04.main and J04.must.1 on alerts written by the real fan-out, plus the 390 px phone,
    the empty, filtered, scoped and no-access states, keyboard, axe, the no-dead-controls crawl, and three baseline
    regions (the "Coming, and in force" and "A draft is marked as a draft" panels, and the phone's kicker and title);
  - `src/lib/alerts/model.test.ts` and `src/components/alerts/alerts.test.tsx`: the model and every state, including
    loading and error.

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
  `app.rollup_state` (read for the whole board in one `app.board_rollup` call, incident #315), the ruleset each
  row was judged against, and the legend. The rows the filters keep are paged, 50 a page in name order (`?page=N`,
  a link like the filters; a filter link starts again at page 1; a page past the end shows the last), with a "Board
  pages" nav under the grid ("ROWS a–b OF n", PREVIOUS, PAGE x OF y, NEXT) shown only when there is more than one
  page; the summary counts every product (founder decision 25 Nov 2026, issue 311). `?view=findings` lists the open findings
  across the portfolio (F04). Empty: "Add a product". An empty workspace keeps the screen title "Board".
- **Not built** (#56): the "Obligations with a date" tile, S-MOB-001 at 390 px (its data is `app.board_rollup`'s
  `product_state`), S-MIS-003's search and saved views (F02, LATER). At 300 recipes the full grid was ~4 MB of HTML;
  paged, the first page is ~0.6 MB (26 KB gzipped), about 275 ms locally against about 480 ms (issue 311).
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
  alone and keeps the email after a refused attempt (3.3.7). On reset, the password requirement is the field's accessible
  description and the strength read-out is announced as it changes (1.3.1, 3.3.2, 4.1.3).
- **Fixed.** Page titles on 45 routes (they all read "Nutrivo"); the skip link; an in-text link told apart by colour
  alone (artwork in progress); focus on the hidden stage radios and an invisible file-input stop (Add a product);
  table scrollers that let `sr-only` text widen the page at 320 px (board, people, audit log, coverage, DataTable);
  the sign-in email cleared after a refused attempt; form-field hints that were never linked to their field (reset
  password, invitation); a header landmark on /admin's staff-only page.
- **Open (#82, needs-human).** The public marketing routes are drawn at a fixed 1280 px (design/public), so they
  scroll sideways below that width and do not meet 1.4.10 Reflow; making them reflow needs a narrow-screen design.
  Unknown URLs show Next's default 404, which has no `<main>` and none of the site's chrome; no design draws a 404.

### Built in T-604: sharing a report (`apps/web/src/components/report/SendReport.tsx`, `apps/web/src/components/share`)
- **S-NV2-026 Export, send, share** gets its Email and Share by link controls back, inside the existing cards (#58 Q6):
  Email sends Template 01 to one address; Share by link makes a link shown once (only its SHA-256 is stored); Link
  settings sets the expiry (7, 30 by default, 90 days or none) and lists the shares, each revocable. A share made sends
  `report_shared` (docs/17). 50 email shares per workspace per UTC day (P0050) and the hourly notify limit (P0049) read
  as refusals on the card, never as errors.
- **`/share/[token]`**, the recipient's page, has no design of its own: it is laid out like Public verification
  (S-NV2-027), sharing its frame (`PublicCardFrame` in `components/verify/VerifyScreen.tsx`), with its states (the
  answer, unknown, too many requests, not answered, loading) and three state tiles. The answer card lists the report's
  face facts in an ink card (never a state colour or the accent: a share is not a verdict), with Download PDF (a fresh
  link signed for 300 s by the `share` Edge Function on each click) and a link to `/verify/<ref>`. A revoked, expired,
  unknown or malformed link shows one identical Unknown card. `noindex`, `Referrer-Policy: no-referrer`; axe in
  `share.spec.ts` and `a11y.spec.ts`.

### Built in T-1110: the Settings & roles overview (`apps/web/src/components/settings/Overview.tsx`, `apps/web/src/lib/settings/overview.ts`)
- **S-NV2-017 Settings & roles** at `/w/[workspace]/settings`, the summary of Workspace Settings, in the Nutrivo 2.0
  shell under the design's header ("Settings", "People, signing authority and workspace") with the ruleset chip:
  - "People and roles": active members (`readPeople`, T-107) with their role (the four roles; the design's job titles
    are stored nowhere), last activity, and signing authority from active `app.signing_grants` rows only, as market
    codes, or None (BE-04: never implied by a role; an external person's None is drawn in the action colour, since
    they can never hold one). Pending invitations are counted under the table;
  - "Workspace": only the rows with data and a decision behind them (founder decision on #352, 26 Nov 2026): Ruleset
    version (the latest released), Markets enabled (the nodes in the entitled regions, linking Coverage & confidence)
    and Signing policy PER MARKET. The design's Tenancy model and Term register version rows are not built;
  - the Plan card shows what D-03 sells (#352): plan, recipes and editor seats against their limits with viewers free,
    regions, and checks this month, unmetered. It is read only by an internal admin of the whole workspace
    (`app.billing_context`); any other admin is told who manages the plan. The design's "Portfolio, not activity"
    figures (products × jurisdiction nodes) contradict D-03 and are not built.
- **Links, no buttons.** Each section links the page that changes it: People and roles, Workspace, Audit log, Data and
  retention, Your account, Plan and allowance.
- **States.** Loaded; empty (the admin alone: an EmptyState linking People and roles); loading (`loading.tsx`); error
  (the workspace error boundary); no-permission below admin, with nothing read.
- **Tests** (`tests/e2e/settings-overview.spec.ts`): every state, axe, the no-dead-controls crawl, and both section
  headings against the S-NV2-017 baseline; the wording in `src/lib/settings/overview.test.ts`.

## 6 · Performance
Lighthouse budgets on the public pages (LCP under 2.5 s); a 1.5 s budget for the board with 300 recipes
(spec/nfr.yaml).
