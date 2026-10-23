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
