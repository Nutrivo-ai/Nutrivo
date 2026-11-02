import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { makeLimiter, normaliseRef, parseVerification, verificationFacts, verifyReference, visitorOf } from "./verify";

const REF = "N7QK42P9MXR31ABCDEFGHJKLMQ";
const CURRENT = { status: "current", issued_at: "2026-08-25T09:14:00+00:00", ruleset_version: "2026.08", has_not_assessed: true };

function deps(answer: { status?: number; body?: unknown; throws?: boolean; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer.throws) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body ?? CURRENT), { status: answer.status ?? 200, headers: answer.headers });
  }) as unknown as typeof fetch;
  return { calls, deps: { url: "http://api.local/", anonKey: "anon-key", fetchFn, now: () => 0, limit: makeLimiter(100) } };
}

const who = { requestId: "req-1", visitor: "192.0.2.7" };

describe("public verification (I04, S-NV2-027)", () => {
  it("[I04.main] asks the verify Edge Function with the anon key and shows the five facts of the design", async () => {
    const { calls, deps: d } = deps();
    const outcome = await verifyReference(REF, who, d);
    expect(outcome).toEqual({ kind: "answer", verification: CURRENT });
    expect(calls[0].url).toBe(`http://api.local/functions/v1/verify/${REF}`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer anon-key");
    expect(headers["x-request-id"]).toBe("req-1");
    expect(headers["x-forwarded-for"]).toBe("192.0.2.7");
    expect(verificationFacts(REF, CURRENT as never)).toEqual([
      { k: "Reference", v: REF },
      { k: "Document type", v: "Report of Check · generated, attested by nobody" },
      { k: "Issued", v: "25 August 2026" },
      { k: "Ruleset version", v: "2026.08" },
      { k: "Items not assessed", v: "Yes — the report lists them by name" },
    ]);
  });

  it("[I04.main] only the BE-28 fields are taken from the answer; anything else is not an answer", () => {
    expect(parseVerification({ ...CURRENT, workspace: "Halden", findings: [] })).toEqual(CURRENT);
    expect(parseVerification({ status: "current" })).toBeNull();
    expect(parseVerification({ status: "revoked" })).toBeNull();
    expect(parseVerification(null)).toBeNull();
  });

  it("[I04.fail.1] an unknown reference shows only the reference typed, and a malformed one never leaves the server", async () => {
    expect(verificationFacts(REF, { status: "unknown" })).toEqual([{ k: "Reference", v: REF }]);
    const { calls, deps: d } = deps({ throws: true });
    for (const probe of ["short", "x".repeat(65), "has space in it padding", "../../etc/passwd/aaaaaaaa"]) {
      expect(await verifyReference(probe, who, d)).toEqual({ kind: "answer", verification: { status: "unknown" } });
    }
    expect(calls).toHaveLength(0);
    expect(normaliseRef(`  ${REF}\n`)).toBe(REF);
    expect(normaliseRef(REF.toLowerCase())).toBe(REF.toLowerCase());
  });

  it("I04: rate limits, the function's 429 and a failing function are errors, never an answer", async () => {
    const limited = deps();
    const one = makeLimiter(1);
    expect((await verifyReference(REF, who, { ...limited.deps, limit: one })).kind).toBe("answer");
    expect(await verifyReference(REF, who, { ...limited.deps, limit: one })).toEqual({ kind: "rate_limited", retryAfter: 60 });
    expect((await verifyReference(REF, { ...who, visitor: "192.0.2.8" }, { ...limited.deps, limit: one })).kind).toBe("answer");

    const upstream = deps({ status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "17" } });
    expect(await verifyReference(REF, who, upstream.deps)).toEqual({ kind: "rate_limited", retryAfter: 17 });
    for (const failing of [deps({ throws: true }), deps({ status: 503, body: { error: "unavailable" } }), deps({ body: { status: "current" } })]) {
      expect(await verifyReference(REF, who, failing.deps)).toEqual({ kind: "unavailable" });
    }
    expect(await verifyReference(REF, who, { ...deps().deps, url: "" })).toEqual({ kind: "unavailable" });
  });

  it("I04: the visitor is the first forwarded address", () => {
    expect(visitorOf(new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
    expect(visitorOf(new Headers({ "x-real-ip": "198.51.100.5" }))).toBe("198.51.100.5");
    expect(visitorOf(new Headers())).toBe("unknown");
  });
});
