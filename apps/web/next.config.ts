import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Release = the git SHA (docs/17): Vercel sets VERCEL_GIT_COMMIT_SHA, CI sets GITHUB_SHA.
const release = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // One server-side DSN (config/env.example SENTRY_DSN), also inlined for the browser SDK.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
    NEXT_PUBLIC_NUTRIVO_ENV: process.env.NUTRIVO_ENV ?? "dev",
    NEXT_PUBLIC_SENTRY_RELEASE: release,
  },
  turbopack: {
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
