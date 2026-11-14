import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Release = the git SHA (docs/17): Vercel sets VERCEL_GIT_COMMIT_SHA, CI sets GITHUB_SHA.
const release = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // One server-side DSN (config/env.example SENTRY_DSN), also inlined for the browser SDK. Staging and production get
  // their values from Infisical under the canonical names in config/secrets.yaml (SUPABASE_URL, SUPABASE_ANON_KEY,
  // POSTHOG_KEY, POSTHOG_HOST, SENTRY_DSN_WEB), so each browser variable falls back to its canonical name.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN || process.env.SENTRY_DSN_WEB || "",
    NEXT_PUBLIC_NUTRIVO_ENV: process.env.NUTRIVO_ENV ?? "dev",
    NEXT_PUBLIC_SENTRY_RELEASE: release,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.POSTHOG_KEY || "",
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST || process.env.POSTHOG_HOST || "",
  },
  // The repository root, so the public pricing page can import config/pricing.ts, the single source of prices that the
  // Stripe catalogue script also reads (docs/08-billing.md, T-603). File tracing uses the same root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  turbopack: {
    root: path.join(__dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Source maps are uploaded only where CI provides SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT_WEB.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_WEB,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: release ? { name: release } : undefined,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
  silent: !process.env.CI,
});
