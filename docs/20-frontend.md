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
- **Gate G4.** The founders approve the inventory; from then on it is the frontend's target.

## 3 · Demo data identical to the design (T-013)
The mock data inside the design files' component scripts (Halden Pet Nutrition, its recipes, markets and findings) is
extracted into `supabase/seed/demo/`. Loaded into local, CI and the staging demo workspace, it makes each built screen
directly comparable with its baseline.

## 4 · Building screens
- **Order.** Tokens and the component kit come first (T-101); then the shell and routing (T-102); then each screen
  inside the task that owns its workflows.
- **Visual check.** Each screen's Playwright visual test compares the route, rendered with demo data, against its
  baseline (`maxDiffPixelRatio` from spec/nfr.yaml, 2%). The PR shows the diff image.
- **Interaction.** A no-dead-controls test clicks every button and link on each screen in the demo workspace. It
  expects a navigation, a dialog, a request or a visible state change, and no console error, failed request or
  unhandled rejection.
- **Accessibility.** axe-core runs on every route (zero serious or critical findings), with keyboard tests for the
  main flows.

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

## 6 · Performance
Lighthouse budgets on the public pages (LCP under 2.5 s); a 1.5 s budget for the board with 300 recipes
(spec/nfr.yaml).
