import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initAnalytics, posthogOptions } from "./analytics";

vi.mock("posthog-js", () => ({ default: { init: vi.fn() } }));

const HOST = "https://eu.i.posthog.com";

describe("PostHog options (D-25)", () => {
  it("turns every automatic capture off", () => {
    expect(posthogOptions(HOST)).toMatchObject({
      api_host: HOST,
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
    });
  });
});

describe("initAnalytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(posthog.init).mockClear();
  });

  it("starts PostHog in the browser with the D-25 options", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", HOST);
    vi.stubGlobal("window", {});
    expect(initAnalytics()).toBe(true);
    expect(posthog.init).toHaveBeenCalledWith("phc_test", posthogOptions(HOST));
  });

  it("stays off without a key or host", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", HOST);
    vi.stubGlobal("window", {});
    expect(initAnalytics()).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("never starts on the server", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", HOST);
    expect(initAnalytics()).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });
});
