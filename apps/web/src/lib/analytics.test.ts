import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initAnalytics, posthogOptions, track } from "./analytics";

vi.mock("posthog-js", () => ({ default: { init: vi.fn(), capture: vi.fn(), __loaded: false } }));

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

describe("track", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(posthog.capture).mockClear();
    (posthog as unknown as { __loaded: boolean }).__loaded = false;
  });

  it("sends nothing when PostHog was not started", () => {
    vi.stubGlobal("window", {});
    expect(track("workspace_created", { workspace_id: "w1" })).toBe(false);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("sends a docs/17 event with its ids once PostHog is started", () => {
    vi.stubGlobal("window", {});
    (posthog as unknown as { __loaded: boolean }).__loaded = true;
    expect(track("workspace_created", { workspace_id: "w1", plan: "free" })).toBe(true);
    expect(posthog.capture).toHaveBeenCalledWith("workspace_created", { workspace_id: "w1", plan: "free" });
  });
});
