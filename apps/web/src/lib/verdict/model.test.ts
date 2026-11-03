import { describe, expect, it } from "vitest";
import { buildVerdict, VerdictShapeError, type NodeRow, type VerdictCheckRow, type VerdictFindingRow, type VerdictRows } from "./model";

const WS = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const JOB = "33333333-3333-3333-3333-333333333333";
const SHA = "a".repeat(64);

const node = (node_id: string, o: Partial<NodeRow> = {}): NodeRow => ({
  node_id,
  label_state: "not_assessed",
  registration_state: "unknown",
  display_state: "not_assessed",
  open_actions: 0,
  last_check_job_id: JOB,
  ...o,
});
const check = (id: string, node_id: string, label_state: string, o: Partial<VerdictCheckRow> = {}): VerdictCheckRow => ({
  id,
  job_id: JOB,
  node_id,
  label_state,
  ruleset_version: "2026.11-a",
  artwork_sha: SHA,
  at: "2026-11-02T09:00:00Z",
  ...o,
});
const finding = (id: string, check_id: string, o: Partial<VerdictFindingRow>): VerdictFindingRow => ({
  id,
  check_id,
  node_id: "EU-DE",
  rule_key: null,
  gap_id: null,
  state: "not_assessed",
  kind: "label",
  provenance: "not_assessed",
  citation: null,
  message: "Withheld.",
  recommended_action: null,
  confidence: null,
  ...o,
});

function rows(o: Partial<VerdictRows>): VerdictRows {
  return {
    workspaceId: WS,
    productId: P,
    nodeId: "EU-DE",
    jurisdictions: [
      { id: "EU", name: "European Union", parent_id: null },
      { id: "EU-DE", name: "Germany", parent_id: "EU" },
      { id: "EU-FR", name: "France", parent_id: "EU" },
      { id: "US", name: "United States", parent_id: null },
      { id: "US-TX", name: "Texas", parent_id: "US" },
    ],
    nodes: [],
    rollup: null,
    checks: [],
    findings: [],
    gaps: [],
    currentRuleset: "2026.11-a",
    ...o,
  };
}

describe("buildVerdict (S-MOB-003)", () => {
  it("is null for a market the product is not in", () => {
    expect(buildVerdict(rows({ nodes: [node("EU-FR")], rollup: "not_assessed" }))).toBeNull();
  });

  it("blocked: the label is fine and the product still cannot be sold, with the registration pack as the next step", () => {
    const v = buildVerdict(
      rows({
        nodeId: "US-TX",
        nodes: [node("US-TX", { label_state: "clear", registration_state: "not_registered", display_state: "blocked" })],
        rollup: "blocked",
        checks: [check("c1", "US-TX", "clear")],
      }),
    )!;
    expect(v.state).toBe("blocked");
    expect(v.chrome).toBe("US · TX");
    expect(v.title).toBe("Cannot be sold in Texas");
    expect(v.body).toContain("The label passes every encoded rule.");
    expect(v.body).toContain("not registered in Texas");
    expect(v.todo.link).toEqual({ label: "Open the registration pack", href: `/w/${WS}/products/${P}/nodes/US-TX/registration` });
    expect(v.source.kind).toBe("registration");
    expect(v.pinned).toEqual({ rulesetVersion: "2026.11-a", rulesetCurrent: true, artworkSha: SHA, checkedAt: "2026-11-02T09:00:00Z" });
  });

  it("a parent never conceals a failing child: the region's verdict names the child that sets it (BE-15)", () => {
    const v = buildVerdict(
      rows({
        nodeId: "US",
        nodes: [
          node("US", { label_state: "clear", registration_state: "not_required", display_state: "clear" }),
          node("US-TX", { label_state: "clear", registration_state: "expired", display_state: "blocked" }),
        ],
        rollup: "blocked",
        checks: [check("c1", "US", "clear"), check("c2", "US-TX", "clear")],
      }),
    )!;
    expect(v.state).toBe("blocked");
    expect(v.subject).toMatchObject({ nodeId: "US-TX", name: "Texas", isSelf: false });
    expect(v.body).toContain("United States shows it because Texas does");
    expect(v.todo.body).toMatch(/^Renew/);
  });

  it("a roll-up better than a covered market is a shape error, never a better answer", () => {
    expect(() =>
      buildVerdict(rows({ nodeId: "US", nodes: [node("US-TX", { display_state: "blocked" })], rollup: "clear" })),
    ).toThrow(VerdictShapeError);
  });

  it("action: the first action finding's message, its next step, and its rule with provenance", () => {
    const v = buildVerdict(
      rows({
        nodes: [node("EU-DE", { label_state: "action", display_state: "action", open_actions: 2 })],
        rollup: "action",
        checks: [check("c1", "EU-DE", "action")],
        findings: [
          finding("f1", "c1", {
            state: "action",
            provenance: "deterministic_rule",
            rule_key: "EU.767.17.1.a",
            citation: "Reg. (EC) 767/2009 Art. 17(1)(a)",
            message: "The operator's address is missing.",
            recommended_action: "Add the operator's address.",
          }),
          finding("f2", "c1", { state: "action", provenance: "model_judgement", rule_key: "EU.claims.1", confidence: 0.82, message: "Claim." }),
        ],
      }),
    )!;
    expect(v.state).toBe("action");
    expect(v.title).toBe("Action needed in Germany");
    expect(v.body).toBe("The operator's address is missing. 1 more finding on the label report.");
    expect(v.todo).toEqual({ body: "Add the operator's address.", link: { label: "Open the label report", href: `/w/${WS}/products/${P}/report` } });
    expect(v.source).toMatchObject({ kind: "rule", provenance: "deterministic_rule", ruleKey: "EU.767.17.1.a", note: "Not a model judgement." });
  });

  it("not assessed: withheld results link to their coverage gap (docs/04 contract 4)", () => {
    const v = buildVerdict(
      rows({
        nodes: [node("EU-DE")],
        rollup: "not_assessed",
        checks: [check("c1", "EU-DE", "not_assessed")],
        findings: [finding("f1", "c1", { gap_id: "GAP-EU-DE-LBL" })],
        gaps: [{ gap_id: "GAP-EU-DE-LBL", node_id: "EU-DE" }],
      }),
    )!;
    expect(v.state).toBe("not_assessed");
    expect(v.source).toEqual({ kind: "gap", gapId: "GAP-EU-DE-LBL", href: `/w/${WS}/library/coverage/EU-DE#GAP-EU-DE-LBL`, note: "No rule, no verdict." });
    expect(v.todo.link?.href).toBe(`/w/${WS}/library/coverage/EU-DE#GAP-EU-DE-LBL`);
  });

  it("not assessed without a gap says so and is never Clear", () => {
    const v = buildVerdict(
      rows({ nodes: [node("EU-DE")], rollup: "not_assessed", checks: [check("c1", "EU-DE", "not_assessed")], findings: [finding("f1", "c1", {})] }),
    )!;
    expect(v.state).toBe("not_assessed");
    expect(v.source.kind).toBe("ungapped");
  });

  it("no check yet: Not assessed, pointing to Upload & scope", () => {
    const v = buildVerdict(rows({ nodes: [node("EU-DE", { last_check_job_id: null })], rollup: "not_assessed" }))!;
    expect(v.state).toBe("not_assessed");
    expect(v.pinned).toBeNull();
    expect(v.todo.link).toEqual({ label: "Upload & scope", href: `/w/${WS}/products/${P}/check` });
  });

  it("an unknown registration with a clear label is Not assessed, never Clear (BE-14)", () => {
    const v = buildVerdict(
      rows({ nodes: [node("EU-DE", { label_state: "clear", display_state: "not_assessed" })], rollup: "not_assessed", checks: [check("c1", "EU-DE", "clear")] }),
    )!;
    expect(v.state).toBe("not_assessed");
    expect(v.source.kind).toBe("registration");
    expect(v.body).toContain("no registration state is recorded");
  });

  it("Clear only with a latest job of clear checks behind it; otherwise withheld", () => {
    const clearNode = node("EU-DE", { label_state: "clear", registration_state: "not_required", display_state: "clear" });
    const v = buildVerdict(rows({ nodes: [clearNode], rollup: "clear", checks: [check("c1", "EU-DE", "clear")], currentRuleset: "2026.12-a" }))!;
    expect(v.state).toBe("clear");
    expect(v.title).toBe("Clear in Germany");
    expect(v.pinned?.rulesetCurrent).toBe(false);

    // The same state with no check rows from its latest job is withheld, not shown as Clear.
    expect(buildVerdict(rows({ nodes: [clearNode], rollup: "clear", checks: [] }))!.state).toBe("not_assessed");
    // ...and so is one whose latest job holds a check that is not clear, or only an older job's clear check.
    expect(buildVerdict(rows({ nodes: [clearNode], rollup: "clear", checks: [check("c1", "EU-DE", "clear"), check("c2", "EU-DE", "not_assessed")] }))!.state).toBe("not_assessed");
    expect(buildVerdict(rows({ nodes: [clearNode], rollup: "clear", checks: [check("c1", "EU-DE", "clear", { job_id: "old" })] }))!.state).toBe("not_assessed");
  });

  it("a state outside the vocabulary is withheld", () => {
    const v = buildVerdict(rows({ nodes: [node("EU-DE", { display_state: "maybe" })], rollup: "maybe", checks: [check("c1", "EU-DE", "not_assessed")] }))!;
    expect(v.state).toBe("not_assessed");
  });
});
