// T-1111 · S-NV2-024 Check in progress: the job (app.jobs, kind check) as the screen shows it, built against today's
// contract (issue 353, option b): queued, running with the elapsed time, then done, withheld or failed. No rule counts,
// stages or running tallies exist, so none are derived here.
import { describe, expect, it } from "vitest";
import type { JobRow } from "@/lib/jobs/watch";
import { crumbFor, elapsed, isTerminal, movesOn, progressView, scopeLine } from "./inProgress";

const job = (extra: Partial<JobRow> = {}): JobRow => ({ id: "j1", status: "queued", progress: {}, last_error: null, attempts: 0, ...extra });
const view = (row: JobRow | null, opts: { stalled?: boolean; error?: boolean; initial?: JobRow } = {}) =>
  progressView({ row, initial: opts.initial ?? job(), stalled: opts.stalled ?? false, error: opts.error ?? false });

describe("Check in progress (S-NV2-024)", () => {
  it("[T-1111] queued, then running, from the job's status; a retry says it waits to try again", () => {
    expect(view(job())).toEqual({ kind: "queued", retrying: false });
    expect(view(job({ attempts: 1 }))).toEqual({ kind: "queued", retrying: true });
    expect(view(job({ status: "running" }))).toEqual({ kind: "running" });
  });

  it("[T-1111] before the watcher reads, the row the server read shows; a failed first read is said, never a spinner", () => {
    expect(view(null, { initial: job({ status: "running" }) })).toEqual({ kind: "running" });
    expect(view(null, { error: true })).toEqual({ kind: "unreadable" });
    expect(view(job({ status: "running" }), { error: true })).toEqual({ kind: "running" });
  });

  it("[T-1111] done carries the job's own counts, result sets per label state, and nothing else", () => {
    const v = view(job({ status: "succeeded", progress: { outcome: "checked", checks: 4, clear: 1, action: 2, not_assessed: 1 } }));
    expect(v).toEqual({ kind: "done", checks: 4, clear: 1, action: 2, notAssessed: 1, again: false });
  });

  it("[D04.must.1] a finished check with nothing assessed is withheld, never Clear", () => {
    const v = view(job({ status: "succeeded", progress: { outcome: "checked", checks: 2, clear: 0, action: 0, not_assessed: 2 } }));
    expect(v.kind).toBe("withheld");
    expect(view(job({ status: "succeeded", progress: { outcome: "checked", checks: 0 } })).kind).toBe("withheld");
  });

  it("[T-1111] the same revision, ruleset and scope asked again says it was already checked", () => {
    const v = view(job({ status: "succeeded", progress: { outcome: "already_checked", checks: 1, clear: 1, action: 0, not_assessed: 0 } }));
    expect(v).toMatchObject({ kind: "done", again: true });
  });

  it("[D04.fail.1] a job failed for no released ruleset (P0003) says so in plain words", () => {
    const v = view(job({ status: "failed", last_error: "NoReleasedRuleset: P0003", attempts: 3 }));
    expect(v.kind).toBe("failed");
    expect(v.kind === "failed" && v.reason).toContain("not released");
    expect(view(job({ status: "cancelled" })).kind).toBe("failed");
  });

  it("[T-1111] a job not terminal after the lease is stalled; a terminal one never is", () => {
    expect(view(job({ status: "running" }), { stalled: true })).toEqual({ kind: "stalled" });
    expect(view(job(), { stalled: true })).toEqual({ kind: "stalled" });
    expect(view(job({ status: "failed" }), { stalled: true }).kind).toBe("failed");
  });

  it("[T-1111] moves on to the report only when it watched the check finish with results", () => {
    const done = view(job({ status: "succeeded", progress: { checks: 1, clear: 1 } }));
    const withheld = view(job({ status: "succeeded", progress: { checks: 1, not_assessed: 1 } }));
    expect(movesOn(false, done)).toBe(true);
    expect(movesOn(true, done)).toBe(false);
    expect(movesOn(false, withheld)).toBe(false);
    expect(movesOn(false, view(job({ status: "failed" })))).toBe(false);
    expect(movesOn(false, view(job({ status: "running" })))).toBe(false);
    expect([done, withheld].every(isTerminal)).toBe(true);
  });

  it("[T-1111] elapsed time since the check was requested, in words", () => {
    const t0 = Date.parse("2026-11-26T10:00:00Z");
    expect(elapsed("2026-11-26T10:00:00Z", t0 + 41_000)).toBe("41 seconds");
    expect(elapsed("2026-11-26T10:00:00Z", t0 + 1_000)).toBe("1 second");
    expect(elapsed("2026-11-26T10:00:00Z", t0 + 125_000)).toBe("2 minutes 5 seconds");
    expect(elapsed("2026-11-26T10:00:00Z", t0 + 120_000)).toBe("2 minutes");
    expect(elapsed("2026-11-26T10:00:00Z", t0 + 3_780_000)).toBe("1 hour 3 minutes");
    expect(elapsed("2026-11-26T10:00:00Z", t0 - 5_000)).toBe("0 seconds"); // a clock behind the database
    expect(elapsed("not a date", t0)).toBe("0 seconds");
  });

  it("[T-1111] the heading names the product, the markets checked and the printed languages", () => {
    expect(scopeLine("Salmon & Rice Adult 12 kg", 9, 11)).toBe("Salmon & Rice Adult 12 kg · 9 nodes · 11 languages");
    expect(scopeLine("Kitten 400 g", 1, 1)).toBe("Kitten 400 g · 1 node · 1 language");
    expect(scopeLine("Kitten 400 g", 2, 0)).toBe("Kitten 400 g · 2 nodes");
  });

  it("[T-1111] the crumb follows the state, from the design's \"Check your label · running\"", () => {
    expect(crumbFor({ kind: "running" })).toBe("Check your label · running");
    expect(crumbFor({ kind: "queued", retrying: false })).toBe("Check your label · queued");
    expect(crumbFor({ kind: "failed", reason: "" })).toBe("Check your label · not completed");
  });
});
