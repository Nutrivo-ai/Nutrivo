# apps/web

Next.js App Router (TypeScript, Tailwind, ESLint, `src/`, pnpm), scaffolded in T-007 and built from milestone 1.
Rules for this folder: `.claude/rules/web.md`.

| Script | Does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | ESLint · route types and `tsc` · Vitest (`src/**/*.test.ts`) |
| `pnpm e2e` | Playwright (`tests/e2e`) against `BASE_URL` or `http://localhost:3000`; installs Chromium only in CI |
| `pnpm baselines` | Captures every screen of `spec/screens.yaml` from design/ into `tests/visual/baselines/` (docs/20 §2) |

Wiring, all off when its variables are unset (names from `config/env.example`):
- **Supabase:** `src/lib/supabase/{client,server}.ts` with @supabase/ssr; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Sentry:** `@sentry/nextjs` on client, server and edge; `SENTRY_DSN`, `NUTRIVO_ENV`; release = git SHA; scrubber in
  `src/lib/observability/sentry.ts`. Source maps upload when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB` are set.
- **request_id:** `src/proxy.ts` creates or keeps `x-request-id` on every request (docs/17).
- **PostHog:** `src/lib/analytics.ts`, EU host, started from `src/instrumentation-client.ts` when `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are set. Only the explicit events in docs/17 are sent: autocapture, automatic pageviews, heatmaps and replay are off (D-25).
- **Health:** `GET /api/health`, used by `scripts/ci/e2e.sh` and smoke tests.
- **Vercel:** `vercel.json`, functions in `fra1` (D-02).
