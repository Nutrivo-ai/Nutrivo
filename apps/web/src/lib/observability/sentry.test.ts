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

  // A low-entropy stand-in shaped like a token (32+ base64url characters), so the secrets scan does not flag it.
  const TOKEN = "invite_sample_".repeat(4);

  it("removes an invitation token from the path and from an encoded next= parameter", () => {
    const text = scrubString(
      `GET https://app.nutrivo.ai/invite/${TOKEN}?x=1 then /sign-in?next=%2Finvite%2F${TOKEN} and /invite/${TOKEN}`,
    );
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("/invite/[token]?x=1");
    expect(text).toContain("next=%2Finvite%2F[token]");
  });

  it("[I02.main] removes a share token from the path and from an encoded next= parameter", () => {
    const SHARE = "share_sample_".repeat(4);
    const text = scrubString(
      `GET https://app.nutrivo.ai/share/${SHARE}?x=1 then /sign-in?next=%2Fshare%2F${SHARE} and /share/${SHARE}`,
    );
    expect(text).not.toContain(SHARE);
    expect(text).toContain("/share/[token]?x=1");
    expect(text).toContain("next=%2Fshare%2F[token]");
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: "/", to: `/share/${SHARE}` } });
    expect(JSON.stringify(crumb)).not.toContain(SHARE);
    const tx = scrubTransaction({
      type: "transaction",
      transaction: `/share/${SHARE}`,
      request: { url: `https://app.nutrivo.ai/share/${SHARE}` },
    } as TransactionEvent);
    expect(JSON.stringify(tx)).not.toContain(SHARE);
  });

  it("[H03.must.1] removes a supplier-link token from the path, an encoded next= parameter, breadcrumbs and transactions", () => {
    const LINK = "supplier_sample_".repeat(3);
    const text = scrubString(`GET https://app.nutrivo.ai/supplier/${LINK}?x=1 then /sign-in?next=%2Fsupplier%2F${LINK}`);
    expect(text).not.toContain(LINK);
    expect(text).toContain("/supplier/[token]?x=1");
    expect(text).toContain("next=%2Fsupplier%2F[token]");
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: "/", to: `/supplier/${LINK}` } });
    expect(JSON.stringify(crumb)).not.toContain(LINK);
    const tx = scrubTransaction({
      type: "transaction",
      transaction: `/supplier/${LINK}`,
      request: { url: `https://app.nutrivo.ai/supplier/${LINK}` },
    } as TransactionEvent);
    expect(JSON.stringify(tx)).not.toContain(LINK);
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
