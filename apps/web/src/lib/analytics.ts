import posthog, { type PostHogConfig } from "posthog-js";

// PostHog EU (D-17). Only the explicit product events in docs/17 are sent (D-25): every automatic capture is off, so
// nothing on screen (label text, names, emails) reaches PostHog by itself. Session replay is off (docs/17).
export function posthogOptions(host: string): Partial<PostHogConfig> {
  return {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
  };
}

// Started once from instrumentation-client.ts. Off without a key and host, and never on the server.
export function initAnalytics(): boolean {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host || typeof window === "undefined") return false;
  posthog.init(key, posthogOptions(host));
  return true;
}

/** The only product events PostHog receives (docs/17). Properties carry ids and enums, never free text. */
export type ProductEvent = "workspace_created" | "artwork_uploaded" | "check_completed" | "report_shared" | "checkout_started" | "plan_started";

/** Sends one product event from the browser; a no-op when PostHog was not started (no key, tests, the server). */
export function track(event: ProductEvent, properties: Record<string, string | number | boolean>): boolean {
  if (typeof window === "undefined" || !posthog.__loaded) return false;
  posthog.capture(event, properties);
  return true;
}
