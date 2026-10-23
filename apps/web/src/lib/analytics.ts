import posthog from "posthog-js";

// PostHog EU (D-17), product events from docs/17 only. Session replay is off (docs/17).
// Not mounted yet: whether autocapture and automatic pageviews are on is an open question on issue #16.
export function initAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host || typeof window === "undefined") return;
  posthog.init(key, { api_host: host, disable_session_recording: true });
}
