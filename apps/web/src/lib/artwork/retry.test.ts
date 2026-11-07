import { describe, expect, it, vi } from "vitest";
import { retryExtraction, retryRefusal } from "./retry";

function fakeDb(result: { data: string | null; error: { code: string } | null }) {
  const headers: Record<string, string> = {};
  const calls: { fn: string; args: unknown }[] = [];
  const call = Object.assign(Promise.resolve(result), {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
      return Promise.resolve(result);
    },
  });
  const db = { schema: vi.fn(() => ({ rpc: (fn: string, args: unknown) => (calls.push({ fn, args }), call) })) };
  return { db: db as never, headers, calls };
}

describe("[T-305] retrying a failed extraction from S-NV2-002", () => {
  it("[T-305][D01.main] calls app.retry_extraction with the artwork version and the request id header", async () => {
    const f = fakeDb({ data: "job-1", error: null });
    expect(await retryExtraction(f.db, "av-1", "req-t305-web-0001")).toEqual({ ok: true, jobId: "job-1" });
    expect(f.calls).toEqual([{ fn: "retry_extraction", args: { p_artwork: "av-1" } }]);
    expect(f.headers).toEqual({ "x-request-id": "req-t305-web-0001" });
  });

  it("[T-305] maps refusals to what the person sees, never a raw error", async () => {
    const f = fakeDb({ data: null, error: { code: "42501" } });
    const result = await retryExtraction(f.db, "av-1");
    expect(result).toMatchObject({ ok: false, refusal: { code: "42501", title: expect.stringContaining("role") } });
    expect(retryRefusal("P0002").title).toMatch(/no extraction to retry/);
    expect(retryRefusal(undefined)).toMatchObject({ code: "unknown", body: expect.stringContaining("nothing was counted") });
  });
});
