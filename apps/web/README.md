# apps/web

Next.js App Router (TypeScript, Tailwind, ESLint, `src/`, pnpm), scaffolded in T-007 and built from milestone 1.
Rules for this folder: `.claude/rules/web.md`.

| Script | Does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | ESLint · route types and `tsc` · Vitest (`src/**/*.test.ts`) |
| `pnpm e2e` | Playwright (`tests/e2e`) against `BASE_URL` or `http://localhost:3000`; installs Chromium only in CI. Screenshot assertions read `tests/visual/` (design baselines and the kit's images) |
| `pnpm baselines` | Captures every screen of `spec/screens.yaml` from design/ into `tests/visual/baselines/` (docs/20 §2) |

Design system: the Cobalt tokens are in `src/styles/tokens.css` and the component kit is in
`src/components/kit` (import it from `@/components/kit`). `/kit` and `/kit/empty-and-error-states` are the kit's test
pages and return 404 in production. docs/10 describes both.

Workspace shell (T-102): `src/components/shell` (rail, header, workspace switcher, phone chrome, states) wraps every
route under `src/app/w/[workspace]`. `src/lib/shell/routes.ts` lists those routes and the rail from spec/screens.yaml,
and `src/lib/workspace/memberships.ts` reads the person's memberships under RLS. The test pages are `/kit/shell` and
`/kit/shell/states`. `tests/e2e/shell.spec.ts` needs the local Supabase stack's variables, as `scripts/ci/e2e.sh`
exports them; without them its workspace tests are skipped. Database types are in `src/lib/database.types.ts`
(`make typegen`).

Onboarding (T-106, A01): `/onboarding` is one route whose step is read from the session (`src/lib/onboarding/state.ts`):
signed out is step 01 (sign-up with confirmation, `signUp` in `src/lib/onboarding/actions.ts`), a confirmed account
without a workspace is step 02 (the password typed again and set with `updateUser`, other sessions signed out, then
`app.create_workspace`: an unconfirmed earlier signup's password never survives), and the workspace the person created without an operator is
step 03 (`app.set_default_operator`). A signed-in person with no person row or no live membership lands on
`/onboarding` (`landingPath`), and so does the sign-in link an already registered address is sent from step 01. The screens are in `src/components/onboarding`; the decisions are pure functions
in `src/lib/onboarding/rules.ts`. `tests/e2e/onboarding.spec.ts` follows the confirmation email through Mailpit.

Public site (T-603): `src/app/(public)` holds `/`, `/pricing`, `/coverage`, `/faq`, `/about`, `/for/<segment>` and
`/legal/<doc>`, each ported from its file in design/public/ with `sx()` (`src/lib/public/sx.ts`), which takes the design's
inline style strings as written. Coverage reads only `public.coverage_snapshot()` (`src/lib/public/coverage.ts`); every
price comes from `config/pricing.ts` (`src/lib/public/pricing.ts`), which is why Turbopack's root is the repository
(`next.config.ts`). What each page omits from its design, and why (D-19), is commented where it was. Calls to action go
to `START` in `src/lib/public/links.ts` (`/onboarding`). Tests: `tests/e2e/public*.spec.ts`,
with `tests/e2e/support/public.ts` (axe, the no-dead-controls crawl, the invented claims no page may show).

Wiring, all off when its variables are unset (names from `config/env.example`):
- **Supabase:** `src/lib/supabase/{client,server}.ts` with @supabase/ssr; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Sentry:** `@sentry/nextjs` on client, server and edge; `SENTRY_DSN`, `NUTRIVO_ENV`; release = git SHA; scrubber in
  `src/lib/observability/sentry.ts`. Source maps upload when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB` are set.
- **request_id:** `src/proxy.ts` creates or keeps `x-request-id` on every request (docs/17).
- **PostHog:** `src/lib/analytics.ts`, EU host, started from `src/instrumentation-client.ts` when `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are set. Only the explicit events in docs/17 are sent: autocapture, automatic pageviews, heatmaps and replay are off (D-25).
- **Health:** `GET /api/health`, used by `scripts/ci/e2e.sh` and smoke tests.
- **Vercel:** `vercel.json`, functions in `fra1` (D-02).
