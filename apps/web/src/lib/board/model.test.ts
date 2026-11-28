import { describe, expect, it } from "vitest";
import {
  BOARD_PAGE,
  blockedBy,
  boardHref,
  buildBoard,
  buildFindings,
  labelOf,
  parseFilters,
  registrationOf,
  type BoardCell,
  type BoardFilters,
  type BoardJurisdictionRow,
  type BoardNodeRow,
  type BoardProductRow,
  type BoardRows,
  type MarketCell,
  type PortfolioFindingRow,
} from "./model";

const WS = "00000000-0000-4000-8000-000000000001";
const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "10000000-0000-4000-8000-000000000002";
const JOB = "20000000-0000-4000-8000-000000000001";
const OLD_JOB = "20000000-0000-4000-8000-000000000002";
const RS = "2026.08-b";

const J: BoardJurisdictionRow[] = [
  { id: "EU", name: "European Union", parent_id: null, node_type: "region" },
  { id: "US", name: "United States", parent_id: null, node_type: "region" },
  { id: "EU-DE", name: "Germany", parent_id: "EU", node_type: "country" },
  { id: "EU-AT", name: "Austria", parent_id: "EU", node_type: "country" },
  { id: "EU-SE", name: "Sweden", parent_id: "EU", node_type: "country" },
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
  label_state: "not_assessed",
  registration_state: "unknown",
  display_state: "not_assessed",
  ruleset_version: null,
  open_actions: 0,
  last_check_job_id: null,
  ...extra,
});
const FILTERS: BoardFilters = { state: null, market: null, density: "comfortable", view: "board" };

function rows(over: Partial<BoardRows> = {}): BoardRows {
  return {
    workspaceId: WS,
    products: [product(P1, "Salmon"), product(P2, "Feline", { species: "cat" })],
    nodes: [
      // Germany: two open findings, registered.
      node(P1, "EU-DE", { label_state: "action", display_state: "action", open_actions: 2, ruleset_version: RS, registration_state: "registered", last_check_job_id: JOB }),
      // Austria: Label clear with registration Unknown: the label line stays "Label clear", the registration line says Unknown.
      node(P1, "EU-AT", { label_state: "clear", display_state: "not_assessed", ruleset_version: RS, registration_state: "unknown", last_check_job_id: JOB }),
      // Sweden: clear label, registration expired, so display_state is blocked.
      node(P1, "EU-SE", { label_state: "clear", display_state: "blocked", ruleset_version: RS, registration_state: "expired", last_check_job_id: JOB }),
      // Texas: sold, but the plan holds only EU.
      node(P1, "US-TX", { label_state: "action", display_state: "blocked", ruleset_version: RS, registration_state: "not_registered" }),
      // Feline: Germany only, never checked.
      node(P2, "EU-DE"),
    ],
    jurisdictions: J,
    entitledRegions: ["EU"],
    filters: FILTERS,
    ...over,
  };
}

const cellOf = (board: ReturnType<typeof buildBoard>, productId: string, nodeId: string): BoardCell =>
  board.rows.find((r) => r.productId === productId)!.cells.find((c) => c.nodeId === nodeId)!;
const market = (c: BoardCell) => {
  expect(c.kind).toBe("market");
  return c as MarketCell;
};

describe("the two lines of a cell", () => {
  it("reads the label line from label_state, and Not checked yet when no check reached the market", () => {
    expect(labelOf({ label_state: "clear", ruleset_version: RS })).toBe("clear");
    expect(labelOf({ label_state: "action", ruleset_version: RS })).toBe("action");
    expect(labelOf({ label_state: "not_assessed", ruleset_version: RS })).toBe("not_assessed");
    expect(labelOf({ label_state: "clear", ruleset_version: null })).toBe("never");
    // Anything the vocabulary does not know is withheld, never shown as a verdict.
    expect(labelOf({ label_state: "green", ruleset_version: RS })).toBe("not_assessed");
    expect(labelOf({ label_state: null, ruleset_version: RS })).toBe("not_assessed");
  });

  it("reads the registration line from registration_state; anything unknown is Unknown", () => {
    expect(registrationOf("registered")).toBe("registered");
    expect(registrationOf("not_required")).toBe("not_required");
    expect(registrationOf("pending")).toBe("unknown");
    expect(registrationOf(null)).toBe("unknown");
  });

  it("is Blocked only where display_state is blocked, naming which registration blocks sale", () => {
    expect(blockedBy({ display_state: "blocked", registration_state: "expired" })).toBe("expired");
    expect(blockedBy({ display_state: "blocked", registration_state: "not_registered" })).toBe("not_registered");
    expect(blockedBy({ display_state: "not_assessed", registration_state: "unknown" })).toBeNull();
  });
});

describe("the matrix (S-MTX-001)", () => {
  it("[F01.main] has a column per market the products are sold in, with no region roll-up column, and one outside the plan last", () => {
    const b = buildBoard(rows());
    expect(b.columns.map((c) => c.nodeId)).toEqual(["EU-AT", "EU-DE", "EU-SE", "US-TX"]);
    expect(b.columns.map((c) => c.code)).toEqual(["AT", "DE", "SE", "TX"]);
    expect(b.columns.find((c) => c.nodeId === "US-TX")!.locked).toBe(true);
    expect(b.columns.filter((c) => c.locked)).toHaveLength(1);
    expect(b.marketCount).toBe(4);
  });

  it("keeps a market's two lines apart: Label clear stays Label clear beside Unknown registration, never a bare Clear", () => {
    const b = buildBoard(rows());
    const at = market(cellOf(b, P1, "EU-AT"));
    expect(at).toMatchObject({ label: "clear", registration: "unknown", blocked: null });
    expect(at.aria).toBe("Salmon, Austria: Label clear. Registration: Unknown. Open the market");
  });

  it("puts the Blocked chip in place of the registration line and keeps the label line", () => {
    const se = market(cellOf(buildBoard(rows()), P1, "EU-SE"));
    expect(se).toMatchObject({ label: "clear", blocked: "expired" });
    expect(se.aria).toContain("Label clear. Registration: Blocked, expired");
  });

  it("counts the open findings of an Action needed market", () => {
    const de = market(cellOf(buildBoard(rows()), P1, "EU-DE"));
    expect(de).toMatchObject({ label: "action", open: 2, registration: "registered" });
    expect(de.aria).toContain("Action needed, 2 open");
  });

  it("says Not checked yet for a market no check reached, and opens the product, never queues a check", () => {
    const b = buildBoard(rows());
    const fe = market(cellOf(b, P2, "EU-DE"));
    expect(fe.label).toBe("never");
    expect(fe.href).toBe(`/w/${WS}/products/${P2}`);
    expect(b.rows.find((r) => r.productId === P2)!.summary).toBe("Not checked yet");
  });

  it("links a verdict to its market, Not assessed to the market's coverage gaps", () => {
    const b = buildBoard(rows());
    expect(market(cellOf(b, P1, "EU-DE")).href).toBe(`/w/${WS}/products/${P1}/nodes/EU-DE`);
    const na = buildBoard(rows({ nodes: [node(P1, "EU-DE", { ruleset_version: RS })] }));
    expect(market(cellOf(na, P1, "EU-DE")).href).toBe(`/w/${WS}/library/coverage/EU-DE`);
  });

  it("gives a market the product is not sold in an inert cell, and one outside the plan a disabled cell", () => {
    const b = buildBoard(rows());
    expect(cellOf(b, P2, "EU-AT")).toEqual({ kind: "none", nodeId: "EU-AT" });
    expect(cellOf(b, P1, "US-TX")).toEqual({ kind: "locked", nodeId: "US-TX", aria: "Salmon, Texas: Not in your plan" });
  });

  it("counts per column 'n of m products label clear', m being the products a check reached there", () => {
    const de = buildBoard(rows()).columns.find((c) => c.nodeId === "EU-DE")!;
    expect([de.clear, de.checked]).toEqual([0, 1]);
    const at = buildBoard(rows()).columns.find((c) => c.nodeId === "EU-AT")!;
    expect([at.clear, at.checked]).toEqual([1, 1]);
  });

  it("summarises a row by markets: open items and blocked, counts only", () => {
    const salmon = buildBoard(rows()).rows.find((r) => r.productId === P1)!;
    expect(salmon.summary).toBe("1 market with open items · 1 blocked");
    expect(salmon.attention).toBe(true);
    const calm = buildBoard(rows({ nodes: [node(P1, "EU-DE", { label_state: "clear", display_state: "clear", ruleset_version: RS, registration_state: "registered" })] }));
    expect(calm.rows[0].summary).toBe("No open items");
  });

  it("leaves discontinued products off the board (F01 step 3)", () => {
    const b = buildBoard(rows({ products: [product(P1, "Salmon"), product(P2, "Feline", { stage: "discontinued" })] }));
    expect(b.rows.map((r) => r.productId)).toEqual([P1]);
    expect(b.productCount).toBe(1);
  });
});

describe("filters, density and pages", () => {
  it("filters rows by state, over the markets shown", () => {
    const ids = (f: Partial<BoardFilters>) => buildBoard(rows({ filters: { ...FILTERS, ...f } })).rows.map((r) => r.productId);
    expect(ids({ state: "action" })).toEqual([P1]);
    expect(ids({ state: "blocked" })).toEqual([P1]);
    expect(ids({ state: "not_assessed" })).toEqual([]);
    // Texas is outside the plan: its cell is disabled and matches no filter.
    expect(ids({ state: "action", market: "EU-AT" })).toEqual([]);
  });

  it("shows one column for a market filter, and ignores a market outside the plan or not on the board", () => {
    const one = buildBoard(rows({ filters: { ...FILTERS, market: "EU-DE" } }));
    expect(one.columns.map((c) => c.nodeId)).toEqual(["EU-DE"]);
    expect(one.rows.every((r) => r.cells.length === 1)).toBe(true);
    expect(one.filtered).toBe(true);
    expect(buildBoard(rows({ filters: { ...FILTERS, market: "US-TX" } })).columns).toHaveLength(4);
    expect(buildBoard(rows({ filters: { ...FILTERS, market: "EU-FR" } })).filters.market).toBeNull();
  });

  it("reads filters from the URL and ignores what it does not know", () => {
    expect(parseFilters({ state: "action", market: "EU-DE", density: "compact", view: "findings" })).toEqual({
      state: "action",
      market: "EU-DE",
      density: "compact",
      view: "findings",
    });
    expect(parseFilters({ state: "stale", market: "<script>", density: "tiny", view: "x" })).toEqual(FILTERS);
    expect(parseFilters({ page: "2" }).page).toBe(2);
    expect(parseFilters({ page: "0" }).page).toBeUndefined();
  });

  it("keeps filters, density and page in links, and leaves defaults out", () => {
    expect(boardHref(WS, FILTERS)).toBe(`/w/${WS}/board`);
    expect(boardHref(WS, { ...FILTERS, state: "blocked", market: "EU-DE", density: "compact", page: 2 })).toBe(
      `/w/${WS}/board?market=EU-DE&state=blocked&density=compact&page=2`,
    );
    expect(boardHref(WS, { ...FILTERS, view: "findings", density: "compact", page: 3 })).toBe(`/w/${WS}/board?view=findings`);
  });

  it("pages the rows the filters keep, 50 a page, in name order (issue 311)", () => {
    const many = Array.from({ length: 55 }, (_, i) => product(`p${String(i).padStart(3, "0")}`, `Recipe ${String(i).padStart(3, "0")}`));
    const nodes = many.map((p) => node(p.id, "EU-DE"));
    const first = buildBoard(rows({ products: many, nodes }));
    expect(first.rows).toHaveLength(BOARD_PAGE);
    expect([first.page, first.pages, first.matched]).toEqual([1, 2, 55]);
    const last = buildBoard(rows({ products: many, nodes, filters: { ...FILTERS, page: 9 } }));
    expect(last.page).toBe(2);
    expect(last.rows.map((r) => r.name)).toEqual(["Recipe 050", "Recipe 051", "Recipe 052", "Recipe 053", "Recipe 054"]);
  });

  it("[S-MTX-007] holds 50 products by 30 markets on one page", () => {
    const markets = Array.from({ length: 30 }, (_, i) => `EU-M${String(i).padStart(2, "0")}`);
    const j = [...J, ...markets.map((id) => ({ id, name: id, parent_id: "EU", node_type: "country" }))];
    const many = Array.from({ length: 50 }, (_, i) => product(`p${i}`, `Recipe ${String(i).padStart(2, "0")}`));
    const b = buildBoard(rows({ products: many, nodes: many.flatMap((p) => markets.map((m) => node(p.id, m))), jurisdictions: j }));
    expect(b.columns).toHaveLength(30);
    expect(b.rows).toHaveLength(50);
    expect(b.pages).toBe(1);
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
  const gapped = finding("f-gap", { node_id: "EU-AT", gap_id: "GAP-EU-AT-claims", reason_code: "not_encoded" });
  const sweden = finding("f-se", { node_id: "EU-SE", reason_code: "data_missing" });
  const old = finding("f-old", { checks: { job_id: OLD_JOB, language: "de" } });
  const gaps = [{ gap_id: "GAP-EU-AT-claims", node_id: "EU-AT", domain: "claims", reason_code: "not_encoded", description: "Claims are not encoded" }];

  it("[F04.main] lists the open findings of each market's latest check, actions first, each with its rule or its gap", () => {
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

  it("filters findings like the board: by state, by blocked market, by market; leaves out discontinued products", () => {
    const f = (over: Partial<BoardFilters>) =>
      buildFindings(rows({ filters: { ...FILTERS, view: "findings", ...over } }), [gapped, action, sweden], gaps).items.map((i) => i.finding.id);
    expect(f({ state: "action" })).toEqual(["f-action"]);
    expect(f({ state: "not_assessed" })).toEqual(["f-gap", "f-se"]);
    expect(f({ state: "blocked" })).toEqual(["f-se"]); // Sweden's registration expired
    expect(f({ market: "EU-AT" })).toEqual(["f-gap"]);
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
