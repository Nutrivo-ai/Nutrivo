import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubEvent, scrubString, sentryOptions } from "./sentry";

describe("Sentry scrubber", () => {
  it("removes emails, bearer tokens, JWTs and token query parameters", () => {
    const text = scrubString(
      "user ab@example.com sent Bearer abc.def-123 with eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl to /cb?code=xyz&next=/",
    );
    expect(text).not.toMatch(/ab@example\.com|abc\.def-123|eyJhbGciOi|xyz/);
    expect(text).toContain("next=/");
  });

  it("redacts sensitive keys and keeps only an opaque user id", () => {
    const event = {
      type: undefined,
      message: "failed for ab@example.com",
      request: { headers: { authorization: "Bearer x", cookie: "sb=1", accept: "json" } },
      user: { id: "u-1", email: "ab@example.com", ip_address: "10.0.0.1" },
    } as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.message).toBe("failed for [email]");
    expect(out.request?.headers).toEqual({ authorization: "[redacted]", cookie: "[redacted]", accept: "json" });
    expect(out.user).toEqual({ id: "u-1" });
  });

  it("is disabled without a DSN and samples 0.2 of traces in production", () => {
    expect(sentryOptions(undefined, "dev", undefined).enabled).toBe(false);
    expect(sentryOptions("https://k@o1.ingest.de.sentry.io/1", "prod", "sha").tracesSampleRate).toBe(0.2);
    expect(sentryOptions("https://k@o1.ingest.de.sentry.io/1", "staging", "sha").tracesSampleRate).toBe(1);
    expect(sentryOptions("x", "prod", "sha").sendDefaultPii).toBe(false);
  });
});
