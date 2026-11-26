import { describe, expect, it } from "vitest";
import { latestChecks, reportKey, reportLines, reportState, type CheckRow, type ReportJobRow, type ReportRow } from "./reports";

const check = (id: string, product: string, node: string, language: string | null, at: string): CheckRow => ({
  id,
  product_id: product,
  node_id: node,
  language,
  ruleset_version: "2026.08-b",
  at,
});

const report = (id: string, checkIds: string[], createdAt: string, pdf: string | null = `ws/p/${id}.pdf`): ReportRow => ({
  id,
  ref: `REF${id.toUpperCase()}ABCDEFGHIJKLMNOPQRS`,
  check_ids: checkIds,
  ruleset_version: "2026.08-b",
  artwork_sha: "a".repeat(64),
  pdf_path: pdf,
  created_at: createdAt,
});

const job = (id: string, checkId: string, status: string): ReportJobRow => ({
  id,
  idempotency_key: reportKey(checkId),
  status,
  updated_at: "2026-11-20T10:00:00Z",
});

describe("[T-1112] latest check of each product × market × language", () => {
  it("keeps the newest check per key, newest first, and treats each printed language apart", () => {
    const rows = latestChecks([
      check("c1", "p1", "EU-DE", "de", "2026-11-01T10:00:00Z"),
      check("c2", "p1", "EU-DE", "de", "2026-11-03T10:00:00Z"),
      check("c3", "p1", "EU-DE", "en", "2026-11-02T10:00:00Z"),
      check("c4", "p1", "EU-AT", "de", "2026-11-04T10:00:00Z"),
      check("c5", "p2", "EU-DE", null, "2026-10-01T10:00:00Z"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c4", "c2", "c3", "c5"]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => check(`c${i}`, `p${i}`, "EU-DE", "de", `2026-11-0${i + 1}T00:00:00Z`));
    expect(latestChecks(many, 2).map((r) => r.id)).toEqual(["c4", "c3"]);
  });
});

describe("[T-1112] a check's report state", () => {
  it("is issued when a report pins the check, whatever its job says, and the newest report wins", () => {
    const state = reportState(
      "c1",
      [report("r1", ["c1"], "2026-11-01T00:00:00Z"), report("r2", ["c0", "c1"], "2026-11-02T00:00:00Z")],
      [job("j1", "c1", "failed")],
    );
    expect(state).toMatchObject({ kind: "issued", reportId: "r2", pdf: true });
  });

  it("offers no download when the report has no stored PDF", () => {
    expect(reportState("c1", [report("r1", ["c1"], "2026-11-01T00:00:00Z", null)], [])).toMatchObject({ kind: "issued", pdf: false });
  });

  it("is preparing while the check's job is queued or running", () => {
    expect(reportState("c1", [], [job("j1", "c1", "queued")])).toEqual({ kind: "preparing", jobId: "j1" });
    expect(reportState("c1", [], [job("j1", "c1", "running")])).toEqual({ kind: "preparing", jobId: "j1" });
  });

  it("is failed for a failed or cancelled job, and for a succeeded job whose report this person cannot read (issue 188, default 3)", () => {
    for (const status of ["failed", "cancelled", "succeeded"]) {
      expect(reportState("c1", [], [job("j1", "c1", status)])).toMatchObject({ kind: "failed", jobId: "j1" });
    }
  });

  it("is none when neither a report nor a job exists, and ignores another check's job", () => {
    expect(reportState("c1", [], [job("j2", "c2", "succeeded")])).toEqual({ kind: "none" });
  });
});

describe("[T-1112] report lines", () => {
  it("names the product and market, falls back to the node id, and drops a check whose product is not readable", () => {
    const lines = reportLines(
      [check("c1", "p1", "EU-DE", "de", "2026-11-03T00:00:00Z"), check("c2", "p9", "EU-AT", "de", "2026-11-02T00:00:00Z"), check("c3", "p1", "EU-XX", "de", "2026-11-01T00:00:00Z")],
      [],
      [],
      new Map([["p1", "Harrow Adult Chicken"]]),
      new Map([["EU-DE", "Germany"]]),
    );
    expect(lines.map((l) => [l.checkId, l.product, l.market])).toEqual([
      ["c1", "Harrow Adult Chicken", "Germany"],
      ["c3", "Harrow Adult Chicken", "EU-XX"],
    ]);
  });
});
