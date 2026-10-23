import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/sentry";

// The DSN, environment and release are inlined at build time by next.config.ts.
Sentry.init(
  sentryOptions(
    process.env.NEXT_PUBLIC_SENTRY_DSN,
    process.env.NEXT_PUBLIC_NUTRIVO_ENV,
    process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  ),
);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
