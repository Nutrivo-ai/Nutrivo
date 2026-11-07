import { describe, expect, it } from "vitest";
import {
  asState,
  boardHref,
  buildBoard,
  buildFindings,
  columnsOf,
  currentRuleset,
  parseFilters,
  type BoardJurisdictionRow,
  type BoardNodeRow,
  type BoardProductRow,
  type BoardRows,
  type PortfolioFindingRow,
} from "./model";

const WS = "00000000-0000-4000-8000-000000000001";
const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "10000000-0000-4000-8000-000000000002";
const P3 = "10000000-0000-4000-8000-000000000003";
const JOB = "20000000-0000-4000-8000-000000000001";
const OLD_JOB = "20000000-0000-4000-8000-000000000002";

const J: BoardJurisdictionRow[] = [
  { id: "EU", name: "European Union", parent_id: null, node_type: "region" },
  { id: "US", name: "United States", parent_id: null, node_type: "region" },
  { id: "EU-DE", name: "Germany", parent_id: "EU", node_type: "country" },
  { id: "EU-AT", name: "Austria", parent_id: "EU", node_type: "country" },
  { id: "US-TX", name: "Texas", parent_id: "US", node_type: "state" },
];

const product = (id: string, name: string, extra: Partial<BoardProductRow> = {}): BoardProductRow => ({
  id,
  name,
  stage: "active",
  species: "dog",
  life_stage: "adult",
  format: "dry",
  ...extra,
});
const node = (product_id: string, node_id: string, extra: Partial<BoardNodeRow> = {}): BoardNodeRow => ({
  product_id,
  node_id,
  display_state: "not_assessed",
  ruleset_version: null,
  open_actions: 0,
  last_check_job_id: null,
  ...extra,
});

function rows(over: Partial<BoardRows> = {}): BoardRows {
  return {
    workspaceId: WS,
    products: [product(P1, "Salmon"), product(P2, "Feline", { species: "cat" })],
    nodes: [
      node(P1, "EU-DE", { display_state: "action", open_actions: 2, ruleset_version: "2026.08-b", last_check_job_id: JOB }),
      node(P1, "EU-AT", { display_state: "clear", ruleset_version: "2026.06-a", last_check_job_id: JOB }),
      node(P1, "US-TX", { display_state: "blocked", ruleset_version: "2026.08-b", last_check_job_id: JOB }),
      node(P2, "EU-DE"),
    ],
    jurisdictions: J,
    rollups: [
      { product_id: P1, region_id: "EU", state: "action" },
      { product_id: P1, region_id: "US", state: "blocked" },
      { product_id: P2, region_id: "EU", state: "not_assessed" },
    ],
    rulesets: [
      { id: "2026.06-a", released_at: "2026-06-01T00:00:00Z" },
      { id: "2026.08-b", released_at: "2026-08-14T00:00:00Z" },
    ],
    filters: { state: null, species: null, view: "board" },
    ...over,
  };
}

describe("board columns", () => {
  it("groups markets by region, each group led by its region's roll-up column", () => {
    const groups = columnsOf(rows().nodes, J);
    expect(groups.map((g) => g.regionId)).toEqual(["EU", "US"]);
    expect(groups[0].columns.map((c) => [c.kind, c.label])).toEqual([
      ["region", "EU"],
      ["market", "EU · AT"],
      ["market", "EU · DE"],
    ]);
    expect(groups[1].columns.map((c) => c.label)).toEqual(["US", "US · TX"]);
  });

  it("has no column for a market no product is sold in", () => {
    const labels = columnsOf([node(P1, "EU-DE")], J).flatMap((g) => g.columns.map((c) => c.nodeId));
    expect(labels).toEqual(["EU", "EU-DE"]);
  });
});

describe("board cells", () => {
  it("market cells are the database's display_state; region cells are rollup_state as returned", () => {
    const b = buildBoard(rows());
    const salmon = b.rows.find((r) => r.productId === P1)!;
    expect(salmon.cells.map((c) => [c.nodeId, c.state, c.count])).toEqual([
      ["EU", "action", 2],
      ["EU-AT", "clear", null],
      ["EU-DE", "action", 2],
      ["US", "blocked", null],
      ["US-TX", "blocked", null],
    ]);
  });

  it("never computes a region's state: a roll-up that was not read is Not assessed, even over clear markets", () => {
    const b = buildBoard(
      rows({ nodes: [node(P1, "EU-AT", { display_state: "clear", ruleset_version: "2026.08-b" })], rollups: [] }),
    );
    expect(b.rows.find((r) => r.productId === P1)!.cells.find((c) => c.nodeId === "EU")!.state).toBe("not_assessed");
  });

  it("an unknown state reads Not assessed, never Clear", () => {
    expect(asState(null)).toBe("not_assessed");
    expect(asState("pending")).toBe("not_assessed");
    expect(asState("clear")).toBe("clear");
  });

  it("a market the product is not sold in has no state at all, and no link", () => {
    const b = buildBoard(rows());
    const feline = b.rows.find((r) => r.productId === P2)!;
    expect(feline.cells.find((c) => c.nodeId === "US-TX")).toMatchObject({ state: null, href: null });
    expect(feline.cells.find((c) => c.nodeId === "US")).toMatchObject({ state: null, href: null });
  });

  it("links each cell to its product × node", () => {
    const cell = buildBoard(rows()).rows[1].cells.find((c) => c.nodeId === "US-TX")!;
    expect(cell.href).toBe(`/w/${WS}/products/${P1}/nodes/US-TX`);
  });
});

describe("board rows, stats and filters", () => {
  it("leaves discontinued products off the board (F01 step 3)", () => {
    const b = buildBoard(rows({ products: [product(P1, "Salmon"), product(P3, "Old", { stage: "discontinued" })] }));
    expect(b.rows.map((r) => r.productId)).toEqual([P1]);
    expect(b.productCount).toBe(1);
  });

  it("counts unproven market answers and markets stale against the latest release", () => {
    const b = buildBoard(rows());
    expect(b.currentRuleset).toBe("2026.08-b");
    expect(b.stats).toEqual({ unproven: 1, stale: 1 });
    expect(b.marketCount).toBe(3);
  });

  it("states what each row was judged against", () => {
    const b = buildBoard(rows());
    expect(b.rows.find((r) => r.productId === P1)!.freshness).toMatchObject({ kind: "stale", version: "2026.06-a" });
    expect(b.rows.find((r) => r.productId === P2)!.freshness).toMatchObject({ kind: "never", note: "never run" });
  });

  it("filters by state, staleness and species", () => {
    const ids = (f: Partial<BoardRows["filters"]>) =>
      buildBoard(rows({ filters: { state: null, species: null, view: "board", ...f } })).rows.map((r) => r.productId);
    expect(ids({ state: "action" })).toEqual([P1]);
    expect(ids({ state: "not_assessed" })).toEqual([P2]);
    expect(ids({ state: "stale" })).toEqual([P1]);
    expect(ids({ species: "cat" })).toEqual([P2]);
    expect(ids({ state: "action", species: "cat" })).toEqual([]);
  });

  it("reads filters from the URL and ignores what it does not know", () => {
    expect(parseFilters({ state: "action", species: "dog", view: "findings" })).toEqual({ state: "action", species: "dog", view: "findings" });
    expect(parseFilters({ state: "clear", species: "<x>", view: "x" })).toEqual({ state: null, species: null, view: "board" });
    expect(boardHref(WS, { view: "findings", state: "stale" })).toBe(`/w/${WS}/board?view=findings&state=stale`);
    expect(boardHref(WS, {})).toBe(`/w/${WS}/board`);
  });

  it("current is the latest release by date", () => {
    expect(currentRuleset([{ id: "b", released_at: "2026-01-01" }, { id: "a", released_at: "2026-02-01" }, { id: "z", released_at: null }])).toBe("a");
  });
});

describe("portfolio findings (F04)", () => {
  const finding = (id: string, extra: Partial<PortfolioFindingRow>): PortfolioFindingRow => ({
    id,
    check_id: "c1",
    product_id: P1,
    node_id: "EU-DE",
    rule_key: null,
    gap_id: null,
    state: "not_assessed",
    provenance: "not_assessed",
    citation: null,
    message: "Withheld",
    recommended_action: null,
    text_object_id: null,
    bbox_mm: null,
    measured_mm: null,
    required_mm: null,
    reason_code: "data_missing",
    created_at: "2026-11-01T00:00:00Z",
    language: null,
    checks: { job_id: JOB, language: "de" },
    ...extra,
  });
  const action = finding("f-action", {
    state: "action",
    provenance: "deterministic_rule",
    rule_key: "EU.767.netqty",
    citation: "Reg. 767/2009 Art. 17",
    message: "Net quantity too small",
    reason_code: null,
  });
  const gapped = finding("f-gap", {
    node_id: "EU-AT",
    gap_id: "GAP-EU-AT-claims",
    reason_code: "not_encoded",
  });
  const old = finding("f-old", { checks: { job_id: OLD_JOB, language: "de" } });
  const gaps = [{ gap_id: "GAP-EU-AT-claims", node_id: "EU-AT", domain: "claims", reason_code: "not_encoded", description: "Claims are not encoded" }];

  it("lists the open findings of each market's latest check, actions first, each with its rule or its gap", () => {
    const out = buildFindings(rows(), [gapped, old, action], gaps);
    expect(out.items.map((i) => i.finding.id)).toEqual(["f-action", "f-gap"]);
    expect(out.counts).toEqual({ action: 1, not_assessed: 1 });
    const [a, g] = out.items;
    expect(a.finding).toMatchObject({ state: "action", ruleKey: "EU.767.netqty", provenance: "deterministic_rule" });
    expect(a.nodeLabel).toBe("EU · DE");
    expect(a.language).toBe("DE"); // the panel the finding was judged on (non-negotiable 4)
    expect(g.finding).toMatchObject({ state: "not_assessed", gapId: "GAP-EU-AT-claims", title: "Claims are not encoded" });
    expect(g.finding.state === "not_assessed" && g.finding.gapId && g.finding.gapHref).toBe(`/w/${WS}/library/coverage/EU-AT#GAP-EU-AT-claims`);
  });

  it("filters findings like the board, and leaves out discontinued products", () => {
    const f = (state: BoardRows["filters"]["state"], species: string | null = null) =>
      buildFindings(rows({ filters: { state, species, view: "findings" } }), [gapped, action], gaps).items.map((i) => i.finding.id);
    expect(f("action")).toEqual(["f-action"]);
    expect(f("not_assessed")).toEqual(["f-gap"]);
    expect(f("stale")).toEqual(["f-gap"]); // EU-AT was judged against 2026.06-a
    expect(f(null, "cat")).toEqual([]);
    const gone = buildFindings(rows({ products: [product(P1, "Salmon", { stage: "discontinued" })] }), [action], gaps);
    expect(gone.total).toBe(0);
  });

  it("shows a bounded list but counts everything", () => {
    const many = Array.from({ length: 5 }, (_, i) => finding(`f${i}`, {}));
    const out = buildFindings(rows(), many, gaps, 2);
    expect(out.items).toHaveLength(2);
    expect(out.total).toBe(5);
  });
});
