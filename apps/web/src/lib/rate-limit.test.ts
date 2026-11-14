// T-1103: the database's rate limit (P0049) as what the person reads, at the helper and at the web call sites that
// map an RPC refusal.
import { describe, expect, it } from "vitest";
import { registerFailure } from "@/lib/artwork/upload";
import { retryRefusal } from "@/lib/artwork/retry";
import { envelopeRefusal } from "@/lib/briefs/rules";
import { checkRefusal, requestCheck } from "@/lib/checks/run";
import { productRefusal } from "@/lib/products/rules";
import { settingsRefusal } from "@/lib/settings/refusal";
import { isRateLimited, rateLimitMessage, retryAfterSeconds } from "./rate-limit";

const limited = (retry_after_s?: unknown, kind = "check") => ({
  code: "P0049",
  message: `too many ${kind} requests: try again later`,
  hint: retry_after_s === undefined ? JSON.stringify({ kind }) : JSON.stringify({ kind, retry_after_s }),
});

describe("rate-limit helper", () => {
  it("[T-1103] recognises P0049 and nothing else", () => {
    expect(isRateLimited(limited(60))).toBe(true);
    expect(isRateLimited({ code: "P0003" })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });

  it("[T-1103] rounds the wait up to whole minutes", () => {
    expect(rateLimitMessage(limited(600))).toEqual({ title: "Too many requests", body: "Too many requests; try again in 10 minutes." });
    expect(rateLimitMessage(limited(61)).body).toBe("Too many requests; try again in 2 minutes.");
  });

  it("[T-1103] says 1 minute, singular, for a wait of a minute or less", () => {
    expect(rateLimitMessage(limited(60)).body).toBe("Too many requests; try again in 1 minute.");
    expect(rateLimitMessage(limited(5)).body).toBe("Too many requests; try again in 1 minute.");
    expect(rateLimitMessage(limited(0)).body).toBe("Too many requests; try again in 1 minute.");
  });

  it("[T-1103] says a few minutes when the hint is missing, malformed or has no usable number", () => {
    const few = "Too many requests; try again in a few minutes.";
    expect(rateLimitMessage({ code: "P0049" }).body).toBe(few);
    expect(rateLimitMessage({ code: "P0049", hint: null }).body).toBe(few);
    expect(rateLimitMessage({ code: "P0049", hint: "not json {" }).body).toBe(few);
    expect(rateLimitMessage({ code: "P0049", hint: "null" }).body).toBe(few);
    expect(rateLimitMessage({ code: "P0049", hint: "42" }).body).toBe(few);
    expect(rateLimitMessage(limited()).body).toBe(few);
    expect(rateLimitMessage(limited("90")).body).toBe(few);
    expect(rateLimitMessage(limited(-5)).body).toBe(few);
    expect(retryAfterSeconds({ code: "P0049", hint: '{"retry_after_s": 1e400}' })).toBeNull();
  });

  it("[T-1103] adds the surrounding copy's nothing-was-queued sentence", () => {
    expect(rateLimitMessage(limited(120), "Nothing was run and nothing was counted.").body).toBe(
      "Too many requests; try again in 2 minutes. Nothing was run and nothing was counted.",
    );
  });
});

describe("rate limit at the call sites", () => {
  it("[T-1103] checkRefusal reads P0049 with its wait, and says nothing was run", () => {
    const r = checkRefusal(limited(240));
    expect(r).toEqual({
      code: "P0049",
      title: "Too many requests",
      body: "Too many requests; try again in 4 minutes. Nothing was run and nothing was counted.",
    });
    expect(checkRefusal("P0049").body).toMatch(/a few minutes/);
    expect(checkRefusal(limited(240)).code).not.toBe("unknown");
  });

  it("[T-1103] requestCheck passes the whole error, so the hint reaches the refusal", async () => {
    const result = { data: null, error: limited(30) };
    const db = { schema: () => ({ rpc: () => Object.assign(Promise.resolve(result), { setHeader: () => Promise.resolve(result) }) }) };
    const r = await requestCheck(db as never, "p-1", "req-1");
    expect(r).toEqual({ ok: false, refusal: expect.objectContaining({ code: "P0049", body: expect.stringMatching(/1 minute\./) }) });
  });

  it("[T-1103] registerFailure (register_artwork) reads P0049 and says nothing was counted", () => {
    const f = registerFailure(limited(3600, "extract"));
    expect(f.code).toBe("P0049");
    expect(f.title).toBe("Too many requests");
    expect(f.body).toMatch(/^Too many requests; try again in 60 minutes\. .*nothing was counted against your allowance\.$/);
    // the codes it already knew are unchanged
    expect(registerFailure("P0032").code).toBe("P0032");
    expect(registerFailure(undefined).code).toBe("unknown");
  });

  it("[T-1103] retryRefusal (retry_extraction) reads P0049", () => {
    expect(retryRefusal(limited(90, "extract"))).toMatchObject({ code: "P0049", body: expect.stringMatching(/2 minutes\. Nothing changed/) });
  });

  it("[T-1103] productRefusal (create_product) reads P0049 from code and hint", () => {
    const r = productRefusal("P0049", "ws", JSON.stringify({ kind: "notify", retry_after_s: 300 }));
    expect(r).toEqual({ code: "P0049", title: "Too many requests", body: "Too many requests; try again in 5 minutes. Nothing was created." });
  });

  it("[T-1103] envelopeRefusal (request_envelope) is rate-limited with its own message, not an error", () => {
    expect(envelopeRefusal(limited(120, "envelope"))).toEqual({
      reason: "rate-limited",
      message: "Too many requests; try again in 2 minutes. Nothing was screened.",
    });
    expect(envelopeRefusal({ code: "P0003" })).toEqual({ reason: "no-ruleset" });
    expect(envelopeRefusal({ code: "22023" })).toEqual({ reason: "no-markets" });
    expect(envelopeRefusal({ code: "42501" })).toEqual({ reason: "no-permission" });
    expect(envelopeRefusal({ code: "XX000" })).toEqual({ reason: "error" });
  });

  it("[T-1103] settingsRefusal (invite_member) is rate-limited with its own problem, not an error", () => {
    expect(settingsRefusal(limited(undefined, "notify"))).toEqual({
      reason: "rate-limited",
      problem: "Too many requests; try again in a few minutes. Nothing was changed.",
    });
    expect(settingsRefusal({ code: "P0033" })).toEqual({ reason: "no-seat" });
    expect(settingsRefusal({ code: "XX000" })).toEqual({ reason: "error" });
  });
});
