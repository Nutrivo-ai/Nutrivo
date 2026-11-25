import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { makeLimiter } from "./verify";
import { openSharedReport, parseShare, pdfUrl, sharedFacts, sharedPdfLink, type SharedReport } from "./share";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const REF = "N7QK42P9MXR31ABCDEFGHJKLMQ";
const OPEN: SharedReport = {
  status: "open", ref: REF, issued_at: "2026-08-25T14:08:00+00:00", ruleset_version: "2026.08",
  artwork_sha: "4f1c" + "0".repeat(56) + "9ab2", has_not_assessed: true, workspace_name: "Halden Pet Nutrition",
  product_name: "Salmon & Rice Adult 12 kg", node_id: "EU-DE", expires_at: "2026-12-25T09:00:00+00:00", has_pdf: true,
};
const SIGNED = `/object/sign/reports/w/p/${REF}.pdf?token=jwt&download=${REF}.pdf`;

function deps(answer: { status?: number; body?: unknown; throws?: boolean; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer.throws) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body ?? OPEN), { status: answer.status ?? 200, headers: answer.headers });
  }) as unknown as typeof fetch;
  return { calls, deps: { url: "http://api.local/", anonKey: "anon-key", fetchFn, now: () => 0, limit: makeLimiter(100) } };
}

const who = { requestId: "req-1", visitor: "192.0.2.7", userAgent: "Mozilla/5.0 test" };

describe("shared report page (I02, D-30, T-604)", () => {
  it("[I02.main] asks the share Edge Function with the anon key, the token in the POST body only", async () => {
    const { calls, deps: d } = deps();
    expect(await openSharedReport(TOKEN, who, d)).toEqual({ kind: "answer", share: OPEN });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://api.local/functions/v1/share");
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer anon-key");
    expect(headers.apikey).toBe("anon-key");
    expect(headers["x-forwarded-for"]).toBe("192.0.2.7");
    expect(headers["x-region"]).toBe("eu-central-1");
    expect(headers["x-request-id"]).toBe("req-1");
    expect(headers["user-agent"]).toBe("Mozilla/5.0 test");
  });

  it("[I02.main] shows the report's face facts, nothing more", () => {
    expect(sharedFacts(OPEN)).toEqual([
      { k: "Reference", v: REF },
      { k: "Document type", v: "Report of Check · generated, attested by nobody" },
      { k: "Product", v: "Salmon & Rice Adult 12 kg" },
      { k: "Shared by", v: "Halden Pet Nutrition" },
      { k: "Market", v: "EU-DE" },
      { k: "Issued", v: "25 August 2026" },
      { k: "Ruleset version", v: "2026.08" },
      { k: "Artwork hash", v: "sha256 4f1c…9ab2" },
      { k: "Items not assessed", v: "Yes — the report lists them by name" },
      { k: "Link expires", v: "25 December 2026" },
    ]);
    expect(sharedFacts({ ...OPEN, expires_at: null, has_not_assessed: false }).slice(-2)).toEqual([
      { k: "Items not assessed", v: "No" },
      { k: "Link expires", v: "No expiry" },
    ]);
  });

  it("[I02.must.1] a malformed token is unknown at once; the function's unknown is passed on as is", async () => {
    const offline = deps({ throws: true });
    for (const bad of ["", "short", TOKEN + "A", TOKEN.slice(0, 42) + "!"]) {
      expect(await openSharedReport(bad, who, offline.deps)).toEqual({ kind: "answer", share: { status: "unknown" } });
    }
    expect(offline.calls).toHaveLength(0);
    const { deps: d } = deps({ body: { status: "unknown" } });
    expect(await openSharedReport(TOKEN, who, d)).toEqual({ kind: "answer", share: { status: "unknown" } });
    expect(parseShare({ status: "revoked" })).toBeNull();
    expect(parseShare({ status: "open", ref: REF })).toBeNull();
  });

  it("I02: rate limits and failures are their own states, never unknown", async () => {
    expect(await openSharedReport(TOKEN, who, deps({ status: 429, headers: { "retry-after": "12" } }).deps)).toEqual({
      kind: "rate_limited",
      retryAfter: 12,
    });
    for (const d of [deps({ throws: true }), deps({ status: 503, body: { error: "unavailable" } }), deps({ body: { status: "open" } })]) {
      expect(await openSharedReport(TOKEN, who, d.deps)).toEqual({ kind: "unavailable" });
    }
    const limited = { ...deps().deps, limit: makeLimiter(1) };
    await openSharedReport(TOKEN, who, limited);
    expect((await openSharedReport(TOKEN, who, limited)).kind).toBe("rate_limited");
    expect(await openSharedReport(TOKEN, who, { ...deps().deps, anonKey: "" })).toEqual({ kind: "unavailable" });
  });

  it("[I02.main] Download PDF asks for a fresh signed link and builds it on the app's public Supabase URL", async () => {
    const { calls, deps: d } = deps({ body: { ...OPEN, pdf_signed_path: SIGNED } });
    expect(await sharedPdfLink(TOKEN, who, d)).toEqual({ kind: "link", url: `http://api.local/storage/v1${SIGNED}` });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN, pdf: true });
    expect(await sharedPdfLink(TOKEN, who, deps({ body: { ...OPEN, has_pdf: false, pdf_signed_path: null } }).deps)).toEqual({ kind: "no_pdf" });
    expect(await sharedPdfLink(TOKEN, who, deps({ body: { status: "unknown" } }).deps)).toEqual({ kind: "unknown" });
    expect(await sharedPdfLink(TOKEN, who, deps({ body: { ...OPEN, pdf_signed_path: "https://evil/x?token=1" } }).deps)).toEqual({
      kind: "unavailable",
    });
  });

  it("I02: a signed path is accepted only for one object of the reports bucket", () => {
    expect(pdfUrl(SIGNED, "https://x.supabase.co/")).toBe(`https://x.supabase.co/storage/v1${SIGNED}`);
    expect(pdfUrl("/object/sign/other/x?token=1", "https://x.supabase.co")).toBeNull();
    expect(pdfUrl("/object/sign/reports/x.pdf", "https://x.supabase.co")).toBeNull();
    expect(pdfUrl(SIGNED, undefined)).toBeNull();
  });
});
