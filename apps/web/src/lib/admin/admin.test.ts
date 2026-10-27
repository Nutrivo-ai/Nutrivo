import { describe, expect, it } from "vitest";
import { extraction, releaseBlockers, type DraftMember } from "./model";
import { isStaff, refusal } from "./staff";

describe("/admin staff check (T-205)", () => {
  it("is staff only when app_metadata.nutrivo_staff is exactly true", () => {
    expect(isStaff({ app_metadata: { nutrivo_staff: true } })).toBe(true);
    for (const v of [false, "true", 1, null, undefined]) expect(isStaff({ app_metadata: { nutrivo_staff: v } })).toBe(false);
    expect(isStaff({ app_metadata: {} })).toBe(false);
    expect(isStaff(null)).toBe(false);
    // user_metadata is the person's own to edit, so it never counts.
    expect(isStaff({ app_metadata: {}, user_metadata: { nutrivo_staff: true } } as never)).toBe(false);
  });
});

describe("staff RPC refusals", () => {
  it("shows a deliberate refusal with the database's reason", () => {
    expect(refusal({ code: "P0039", message: "K05: no fixture run recorded for draft 2026.11-a" })).toEqual({
      kind: "refused",
      message: "Refused by the release gate (K05): K05: no fixture run recorded for draft 2026.11-a",
    });
    expect(refusal({ code: "P0010", message: "BE-10: EU-SE composition is complete only when …" }).kind).toBe("refused");
    expect(refusal({ code: "22023", message: "BE-11: a pl term is accepted only from the stored official pl text" }).message).toContain("BE-11");
  });
  it("maps 42501 to no-permission and hides anything unexpected", () => {
    expect(refusal({ code: "42501", message: "staff only" }).kind).toBe("no-permission");
    const other = refusal({ code: "XX000", message: "internal detail" });
    expect(other.kind).toBe("error");
    expect(other.message).not.toContain("internal detail");
  });
});

describe("extractions", () => {
  it("is acceptable only as a verified finding with params, article and excerpt", () => {
    const ok = { verified: true, extraction: { found: true, article_ref: "Art. 1(1)", excerpt: "TEST", params: { a: 1 } } };
    expect(extraction(ok)?.acceptable).toBe(true);
    expect(extraction({ ...ok, verified: false })?.acceptable).toBe(false);
    expect(extraction({ verified: true, extraction: { ...ok.extraction, params: [1] } })?.acceptable).toBe(false);
    expect(extraction({ verified: true, extraction: { ...ok.extraction, excerpt: "" } })?.acceptable).toBe(false);
    expect(extraction(null)).toBeNull();
  });
});

describe("release blockers", () => {
  const member = (outcomes: string[]): DraftMember => ({
    ruleKey: "TEST.T205.A", version: 1, title: "t", domain: "composition", nodeId: "EU", fixtureOutcomes: outcomes, fixtures: outcomes.length,
  });
  it("names every reason the release gate will refuse", () => {
    expect(releaseBlockers({ members: [], latestRun: null, fixturesExpected: 0 })).toEqual([
      "The draft has no member rules, so no fixture can pass.",
      "No fixture run is recorded for this draft. The fixture runner records it (T-206).",
    ]);
    expect(releaseBlockers({ members: [member(["passed"])], latestRun: null, fixturesExpected: 1 })[0]).toContain("TEST.T205.A v1");
    const run = { id: "r", passed: true, ruleFixturesRan: 2, runner: "x", ranAt: "2026-10-26T00:00:00Z" };
    expect(releaseBlockers({ members: [member(["failed", "passed", "withheld"])], latestRun: run, fixturesExpected: 3 })).toEqual([
      "The latest fixture run judged 2 of 3 fixtures.",
    ]);
    expect(releaseBlockers({ members: [member(["failed", "passed", "withheld"])], latestRun: { ...run, ruleFixturesRan: 3 }, fixturesExpected: 3 })).toEqual([]);
  });
});
