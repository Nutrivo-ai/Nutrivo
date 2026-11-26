import { describe, expect, it } from "vitest";
import { buildMarkets, kickerOf, marketsTitle, MarketsShapeError, type MarketsCheckRow, type MarketsNodeRow, type MarketsRows } from "./markets";

const WS = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const JOB = "33333333-3333-3333-3333-333333333333";
const OLD = "44444444-4444-4444-4444-444444444444";

const node = (node_id: string, display_state: string, o: Partial<MarketsNodeRow> = {}): MarketsNodeRow => ({
  node_id,
  display_state,
  open_actions: 0,
  ruleset_version: "2026.08-b",
  last_check_job_id: JOB,
  ...o,
});
const check = (node_id: string, label_state: string, o: Partial<MarketsCheckRow> = {}): MarketsCheckRow => ({
  job_id: JOB,
  node_id,
  label_state,
  ruleset_version: "2026.08-b",
  at: "2026-09-02T09:00:00Z",
  ...o,
});

const JURISDICTIONS = [
  { id: "EU", name: "European Union", parent_id: null, node_type: "region" },
  { id: "EU-DE", name: "Germany", parent_id: "EU", node_type: "country" },
  { id: "EU-FR", name: "France", parent_id: "EU", node_type: "country" },
  { id: "US", name: "United States", parent_id: null, node_type: "region" },
  { id: "US-FED", name: "US federal (FDA CVM)", parent_id: "US", node_type: "federal" },
  { id: "US-TX", name: "Texas", parent_id: "US", node_type: "state" },
];

// The design's recipe: Germany clear, France one open action, the US barred because Texas is.
const design = (o: Partial<MarketsRows> = {}): MarketsRows => ({
  workspaceId: WS,
  product: { id: P, name: "Adult dog dry chicken", stage: "active", species: "dog", life_stage: "adult", format: "complete dry" },
  nodes: [node("EU-DE", "clear"), node("EU-FR", "action", { open_actions: 1 }), node("US-FED", "blocked"), node("US-TX", "blocked")],
  jurisdictions: JURISDICTIONS,
  rollups: [
    { region_id: "EU", state: "action" },
    { region_id: "US", state: "blocked" },
  ],
  checks: [check("EU-DE", "clear"), check("EU-FR", "action"), check("US-FED", "clear"), check("US-TX", "clear")],
  currentRuleset: "2026.08-b",
  ...o,
});

describe("S-MOB-002 one recipe, its markets", () => {
  it("[F01.main] the design's recipe: markets grouped by region, each group led by its roll-up, every row opening its verdict", () => {
    const m = buildMarkets(design());
    expect(m.kicker).toBe("Adult dog · complete dry");
    expect(m.title).toBe("Four markets");
    expect(m.groups.map((g) => g.rows.map((r) => [r.label, r.state, r.value]))).toEqual([
      [
        ["EU", "action", "1 open"],
        ["EU · Germany", "clear", "Clear"],
        ["EU · France", "action", "1 open"],
      ],
      [
        ["US", "blocked", "Blocked"],
        ["US · federal", "blocked", "Blocked"],
        ["US · Texas", "blocked", "Blocked"],
      ],
    ]);
    for (const r of m.groups.flatMap((g) => g.rows)) expect(r.href).toBe(`/w/${WS}/products/${P}/nodes/${r.nodeId}`);
    expect(m.checked).toMatchObject({ kind: "checked", body: "2 September 2026 against ruleset 2026.08-b. Current." });
    expect(m.reportHref).toBe(`/w/${WS}/products/${P}/report`);
  });

  it("[F01.must.1] a region row is the database's roll-up, and one better than its worst market is refused, never shown", () => {
    expect(buildMarkets(design()).groups[1].rows[0].state).toBe("blocked");
    expect(() => buildMarkets(design({ rollups: [{ region_id: "EU", state: "action" }, { region_id: "US", state: "clear" }] }))).toThrow(MarketsShapeError);
    // A roll-up the database did not answer is Not assessed, and still cannot hide Texas.
    expect(() => buildMarkets(design({ rollups: [{ region_id: "EU", state: "action" }] }))).toThrow(MarketsShapeError);
    const unread = buildMarkets(design({ nodes: [node("EU-DE", "clear")], rollups: [] }));
    expect(unread.groups[0].rows[0].state).toBe("not_assessed");
  });

  it("[D07.must.2] Clear needs the latest job's checks, all clear; otherwise Not assessed, linking to the verdict that names the gap", () => {
    const m = buildMarkets(
      design({
        nodes: [node("EU-DE", "clear", { last_check_job_id: null }), node("EU-FR", "clear")],
        rollups: [{ region_id: "EU", state: "clear" }],
        checks: [check("EU-FR", "not_assessed"), check("EU-DE", "clear", { job_id: OLD })],
      }),
    );
    const rows = m.groups[0].rows;
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ["EU", "not_assessed"],
      ["EU · Germany", "not_assessed"],
      ["EU · France", "not_assessed"],
    ]);
    expect(rows.every((r) => r.value === "Not assessed" && r.href.includes("/nodes/"))).toBe(true);
  });

  it("anything the vocabulary does not know is Not assessed; a region is not a market", () => {
    const m = buildMarkets(design({ nodes: [node("EU", "clear"), node("EU-DE", "passed")], rollups: [{ region_id: "EU", state: "weird" }] }));
    expect(m.marketCount).toBe(1);
    expect(m.groups[0].rows.map((r) => r.state)).toEqual(["not_assessed", "not_assessed"]);
  });

  it("checked: never run, superseded, older and unchecked markets", () => {
    const never = buildMarkets(design({ nodes: [node("EU-DE", "not_assessed", { last_check_job_id: null })], rollups: [{ region_id: "EU", state: "not_assessed" }], checks: [] }));
    expect(never.checked).toEqual({
      kind: "never",
      body: "No check has run on this product yet, so no market has a verdict.",
      link: { label: "Upload & scope", href: `/w/${WS}/products/${P}/check` },
    });
    const superseded = buildMarkets(design({ currentRuleset: "2026.11-a" }));
    expect(superseded.checked).toMatchObject({ current: false, body: "2 September 2026 against ruleset 2026.08-b. Superseded." });
    const mixed = buildMarkets(
      design({
        nodes: [node("EU-DE", "clear"), node("EU-FR", "action", { open_actions: 2, ruleset_version: "2026.05-a" }), node("US-TX", "not_assessed", { last_check_job_id: null })],
        rollups: [{ region_id: "EU", state: "action" }, { region_id: "US", state: "not_assessed" }],
      }),
    );
    expect(mixed.checked.body).toBe("2 September 2026 against ruleset 2026.08-b. Current. 1 market was checked against an older ruleset. 1 market has no check yet.");
    expect(mixed.groups[0].rows[0].value).toBe("2 open");
  });

  it("the title and kicker say only what is stored", () => {
    expect(marketsTitle(1)).toBe("One market");
    expect(marketsTitle(3)).toBe("Three markets");
    expect(marketsTitle(12)).toBe("12 markets");
    expect(kickerOf({ id: P, name: "x", stage: "in_development", species: null, life_stage: null, format: null })).toBe("In development");
    expect(kickerOf({ id: P, name: "x", stage: "active", species: "other", life_stage: null, format: "wet" })).toBe("Wet");
    expect(kickerOf({ id: P, name: "x", stage: "active", species: "cat", life_stage: "senior", format: null })).toBe("Senior cat");
  });
});
