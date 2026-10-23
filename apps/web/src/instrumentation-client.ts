import * as Sentry from "@sentry/nextjs";
import { initAnalytics } from "@/lib/analytics";
import { sentryOptions } from "@/lib/observability/sentry";

// The DSN, environment and release are inlined at build time by next.config.ts.
Sentry.init(
  sentryOptions(
    process.env.NEXT_PUBLIC_SENTRY_DSN,
    process.env.NEXT_PUBLIC_NUTRIVO_ENV,
    process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  ),
);

// PostHog sends only the explicit events in docs/17 (D-25); off without NEXT_PUBLIC_POSTHOG_KEY and _HOST.
initAnalytics();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
