import { describe, expect, it, vi } from "vitest";
import type { JobRow } from "@/lib/artwork/progress";
import type { RunSummary } from "@/lib/artwork/queries";
import { checkRefusal, describeCheckJob, failedReason, passLine, readiness, requestCheck } from "./run";

const run = (status: RunSummary["status"]): RunSummary => ({ id: "r", status, failureCodes: [], engineVersion: "e", finishedAt: null });
const job = (over: Partial<JobRow>): JobRow => ({ id: "j", status: "queued", progress: {}, last_error: null, attempts: 0, ...over });

describe("readiness of Run the check", () => {
  it("needs an artwork, a finished extraction and a market", () => {
    expect(readiness({ run: null, hasArtwork: false, markets: 2 })).toMatchObject({ ready: false, reason: expect.stringMatching(/Upload the artwork/) });
    expect(readiness({ run: null, hasArtwork: true, markets: 2 })).toMatchObject({ ready: false, reason: expect.stringMatching(/still being read/) });
    expect(readiness({ run: run("running"), hasArtwork: true, markets: 2 })).toMatchObject({ ready: false });
    expect(readiness({ run: run("failed"), hasArtwork: true, markets: 2 })).toMatchObject({ ready: false, reason: expect.stringMatching(/could not be read/) });
    expect(readiness({ run: run("succeeded"), hasArtwork: true, markets: 0 })).toMatchObject({ ready: false, reason: expect.stringMatching(/market/) });
    expect(readiness({ run: run("succeeded"), hasArtwork: true, markets: 1 })).toEqual({ ready: true });
    expect(readiness({ run: run("partial"), hasArtwork: true, markets: 1 })).toEqual({ ready: true });
  });
});

describe("passLine", () => {
  it("words the scope as the design does, singular and plural", () => {
    expect(passLine(9, 11)).toBe("1 product × 9 jurisdiction nodes × 11 languages, answered in one pass");
    expect(passLine(1, 1)).toBe("1 product × 1 jurisdiction node × 1 language, answered in one pass");
  });
});

describe("describeCheckJob", () => {
  it("follows a check job from queued to done, with its counts", () => {
    expect(describeCheckJob(null)).toEqual({ phase: "waiting" });
    expect(describeCheckJob(job({}))).toEqual({ phase: "queued", retrying: false });
    expect(describeCheckJob(job({ attempts: 1 }))).toEqual({ phase: "queued", retrying: true });
    expect(describeCheckJob(job({ status: "running" }))).toEqual({ phase: "running" });
    expect(
      describeCheckJob(job({ status: "succeeded", progress: { outcome: "checked", checks: 8, clear: 0, action: 1, not_assessed: 7 } })),
    ).toEqual({ phase: "done", checks: 8, clear: 0, action: 1, notAssessed: 7, again: false });
    expect(describeCheckJob(job({ status: "succeeded", progress: { outcome: "already_checked", checks: 2 } }))).toMatchObject({ again: true, checks: 2, clear: 0 });
  });

  it("never shows the raw error text of a failed job", () => {
    const view = describeCheckJob(job({ status: "failed", last_error: "PermanentJobError: something internal 1234" }));
    expect(view).toEqual({ phase: "failed", reason: failedReason(null) });
    expect(failedReason("P0003: payload names no released ruleset")).toMatch(/not released/);
  });
});

describe("checkRefusal", () => {
  it.each([
    ["42501", /role/],
    ["P0002", /no artwork/],
    ["P0003", /No ruleset/],
    [undefined, /not started/],
  ])("%s is shown as itself", (code, title) => {
    expect(checkRefusal(code).title).toMatch(title);
  });
});

describe("requestCheck", () => {
  function fakeDb(result: { data: unknown; error: unknown }) {
    const calls: unknown[] = [];
    const call = Object.assign(Promise.resolve(result), {
      setHeader: (k: string, v: string) => {
        calls.push(["header", k, v]);
        return Promise.resolve(result);
      },
    });
    const db = { schema: (s: string) => ({ rpc: (fn: string, args: unknown) => (calls.push([s, fn, args]), call) }) };
    return { db: db as never, calls };
  }

  it("calls app.request_check with the product only, and sends the request id", async () => {
    const { db, calls } = fakeDb({ data: "job-1", error: null });
    await expect(requestCheck(db, "p-1", "req-1")).resolves.toEqual({ ok: true, jobId: "job-1" });
    expect(calls[0]).toEqual(["app", "request_check", { p_product: "p-1" }]);
    expect(calls[1]).toEqual(["header", "x-request-id", "req-1"]);
  });

  it("returns the refusal for a database error", async () => {
    const { db } = fakeDb({ data: null, error: { code: "P0003", message: "no ruleset" } });
    const r = await requestCheck(db, "p-1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "P0003" } });
    vi.restoreAllMocks();
  });
});
