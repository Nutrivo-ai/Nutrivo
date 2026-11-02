import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubString, scrubTransaction, sentryOptions, type TransactionEvent } from "./sentry";

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

  const TOKEN = "Qx7_c2VjcmV0LXRva2VuLTMyLWJ5dGVzLWxvbmctLQ";

  it("removes an invitation token from the path and from an encoded next= parameter", () => {
    const text = scrubString(
      `GET https://app.nutrivo.ai/invite/${TOKEN}?x=1 then /sign-in?next=%2Finvite%2F${TOKEN} and /invite/${TOKEN}`,
    );
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("/invite/[token]?x=1");
    expect(text).toContain("next=%2Finvite%2F[token]");
  });

  it("scrubs transactions and breadcrumbs, which carry URLs too", () => {
    const tx = scrubTransaction({
      type: "transaction",
      transaction: `/invite/${TOKEN}`,
      request: { url: `https://app.nutrivo.ai/invite/${TOKEN}` },
    } as TransactionEvent);
    expect(JSON.stringify(tx)).not.toContain(TOKEN);
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: "/", to: `/invite/${TOKEN}` } });
    expect(JSON.stringify(crumb)).not.toContain(TOKEN);
    const opts = sentryOptions("x", "prod", "sha");
    expect(opts.beforeSendTransaction).toBe(scrubTransaction);
    expect(opts.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it("is disabled without a DSN and samples 0.2 of traces in production", () => {
    expect(sentryOptions(undefined, "dev", undefined).enabled).toBe(false);
    expect(sentryOptions("https://k@o1.ingest.de.sentry.io/1", "prod", "sha").tracesSampleRate).toBe(0.2);
    expect(sentryOptions("https://k@o1.ingest.de.sentry.io/1", "staging", "sha").tracesSampleRate).toBe(1);
    expect(sentryOptions("x", "prod", "sha").sendDefaultPii).toBe(false);
  });
});
