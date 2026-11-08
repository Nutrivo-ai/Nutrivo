import { describe, expect, it } from "vitest";
import { extraction, releaseBlockers, type DraftMember } from "./model";
import { currentLinks, hasLinks, isStaff, linkKind, linksFromForm, refusal, staffMfa } from "./staff";

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

describe("staff work at aal2 only (#35 Q6)", () => {
  it("challenges a staff session at aal1 with a factor, enrols one without, and lets aal2 through", () => {
    expect(staffMfa({ currentLevel: "aal1", nextLevel: "aal2" })).toBe("challenge");
    expect(staffMfa({ currentLevel: "aal1", nextLevel: "aal1" })).toBe("enrol");
    expect(staffMfa({ currentLevel: null, nextLevel: null })).toBe("enrol");
    expect(staffMfa({ currentLevel: "aal2", nextLevel: "aal2" })).toBe("ok");
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

// T-211 · D-31: term links, as the /admin/rules forms build them for app.accept_candidate and app.relink_rule.
function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("[T-211] term links per rule shape (D-31)", () => {
  it("offers detection terms, wording terms or nothing, by shape", () => {
    expect(["mandatory_particular", "threshold", "character_height"].map(linkKind)).toEqual(["detect", "detect", "detect"]);
    expect(linkKind("prescribed_wording")).toBe("wording");
    expect([linkKind("additive_condition"), linkKind("claim_judgement"), linkKind(null)]).toEqual(["none", "none", "none"]);
  });

  it("builds detect links, with a scope only when it is not the default", () => {
    expect(linksFromForm("mandatory_particular", form([["link_detect", "a"], ["link_detect", "b"], ["link_scope", "each_panel_in_node_language"]])))
      .toEqual({ ok: true, links: { detect: { term_keys: ["a", "b"] } } });
    expect(linksFromForm("mandatory_particular", form([["link_detect", "a"], ["link_scope", "any_panel"]])))
      .toEqual({ ok: true, links: { detect: { term_keys: ["a"] }, scope: "any_panel" } });
    // threshold and character_height take no scope.
    expect(linksFromForm("threshold", form([["link_detect", "a"], ["link_scope", "any_panel"]])))
      .toEqual({ ok: true, links: { detect: { term_keys: ["a"] } } });
  });

  it("builds wording links; the prescribed term is never also an alternative", () => {
    expect(linksFromForm("prescribed_wording", form([["link_term_key", "p"], ["link_alternatives", "q"], ["link_alternatives", "p"], ["link_match", "exact"]])))
      .toEqual({ ok: true, links: { term_key: "p", alternative_term_keys: ["q"], match: "exact" } });
    expect(linksFromForm("prescribed_wording", form([["link_term_key", "p"], ["link_match", "case_folded"]])))
      .toEqual({ ok: true, links: { term_key: "p" } });
  });

  it("sends no links when no term is chosen (the rule stays withheld), and refuses alternatives without the term", () => {
    expect(linksFromForm("mandatory_particular", form([["link_scope", "any_panel"]]))).toEqual({ ok: true, links: null });
    expect(linksFromForm("prescribed_wording", form([["link_match", "exact"]]))).toEqual({ ok: true, links: null });
    expect(linksFromForm("additive_condition", form([["link_detect", "a"]]))).toEqual({ ok: true, links: null });
    const refused = linksFromForm("prescribed_wording", form([["link_alternatives", "q"]]));
    expect(refused.ok).toBe(false);
  });

  it("reads a stored version's links back, ignoring the extraction's own params", () => {
    const params = { particular: "x", conditions: [], wordings: ["w"], alternatives: ["source text"], detect: { term_keys: ["a"] }, scope: "any_panel" };
    expect(currentLinks(params)).toEqual({ detect: ["a"], scope: "any_panel", termKey: null, alternatives: [], match: null });
    expect(hasLinks(params)).toBe(true);
    expect(hasLinks({ wordings: ["w"], alternatives: ["source text"] })).toBe(false);
    expect(currentLinks(null)).toEqual({ detect: [], scope: null, termKey: null, alternatives: [], match: null });
  });

  it("shows P0048 as a refusal with the database's reason", () => {
    expect(refusal({ code: "P0048", message: "D-31: EU-FI mandatory_particulars is complete only when ..." }).kind).toBe("refused");
    expect(refusal({ code: "P0048", message: "x" }).message).toBe("Refused: a linked term lacks one of the node's languages (D-31): x");
  });
});
