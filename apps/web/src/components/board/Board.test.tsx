// T-1113 · S-MTX-001 to 011: the matrix and its states rendered, including those the local stack cannot reach end to
// end (Label clear needs an encoded ruleset; the error state needs a failing read).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildBoard, type BoardFilters, type BoardNodeRow } from "@/lib/board/model";
import type { BoardPage } from "@/lib/board/queries";
import { Board, BoardError, BoardLoading, BoardNoAccess } from "./Board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const WS = "00000000-0000-4000-8113-000000000001";
const P1 = "10000000-0000-4000-8113-000000000001";
const P2 = "10000000-0000-4000-8113-000000000002";
const RS = "2026.08-b";
const J = [
  { id: "EU", name: "European Union", parent_id: null, node_type: "region" },
  { id: "US", name: "United States", parent_id: null, node_type: "region" },
  { id: "EU-DE", name: "Germany", parent_id: "EU", node_type: "country" },
  { id: "EU-SE", name: "Sweden", parent_id: "EU", node_type: "country" },
  { id: "EU-FI", name: "Finland", parent_id: "EU", node_type: "country" },
  { id: "US-TX", name: "Texas", parent_id: "US", node_type: "state" },
];
const n = (product_id: string, node_id: string, extra: Partial<BoardNodeRow>): BoardNodeRow => ({
  product_id,
  node_id,
  label_state: "not_assessed",
  registration_state: "unknown",
  display_state: "not_assessed",
  ruleset_version: RS,
  open_actions: 0,
  last_check_job_id: null,
  ...extra,
});

function page(over: { filters?: Partial<BoardFilters>; canCreate?: boolean; empty?: boolean } = {}): Extract<BoardPage, { kind: "loaded" }> {
  const filters: BoardFilters = { state: null, market: null, density: "comfortable", view: "board", ...over.filters };
  const board = buildBoard({
    workspaceId: WS,
    products: over.empty
      ? []
      : [
          { id: P1, name: "Salmon & Rice Adult 12 kg", stage: "active", species: "dog", life_stage: "adult", format: "dry" },
          { id: P2, name: "Senior Cat Salmon 1.5 kg", stage: "active", species: "cat", life_stage: "senior", format: "dry" },
        ],
    nodes: [
      n(P1, "EU-DE", { label_state: "action", display_state: "action", open_actions: 2, registration_state: "registered" }),
      n(P1, "EU-SE", { label_state: "clear", display_state: "not_assessed", registration_state: "unknown" }),
      n(P1, "EU-FI", { label_state: "clear", display_state: "blocked", registration_state: "expired" }),
      n(P1, "US-TX", { label_state: "action", display_state: "blocked", registration_state: "not_registered" }),
      n(P2, "EU-DE", { ruleset_version: null }),
    ],
    jurisdictions: J,
    entitledRegions: ["EU"],
    filters,
  });
  return { kind: "loaded", board, workspaceName: "Halden Pet Nutrition", canCreate: over.canCreate ?? false, findings: null };
}
const render = (p = page()) => renderToStaticMarkup(<Board workspaceId={WS} page={p} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Board as the product matrix (S-MTX-001)", () => {
  it("[T-1113] a cell keeps its two lines: Label clear beside Unknown registration, never a bare Clear", () => {
    const html = render();
    const se = html.match(/<div role="gridcell" data-node="EU-SE"[\s\S]*?<\/a><\/div>/)![0];
    expect(text(se)).toContain("Label clear");
    expect(text(se)).toContain("REG ? Unknown");
    expect(se).toContain('aria-label="Salmon &amp; Rice Adult 12 kg, Sweden: Label clear. Registration: Unknown. Open the market"');
    // "Clear" appears only as "Label clear" (and in "Clear filters"), never alone.
    expect(text(html).match(/\bClear\b/g) ?? []).toEqual([]);
  });

  it("[T-1113] Blocked replaces the registration line, naming which, and the label line stays", () => {
    const fi = render().match(/<div role="gridcell" data-node="EU-FI"[\s\S]*?<\/a><\/div>/)![0];
    expect(text(fi)).toContain("Label clear");
    expect(text(fi)).toContain("Blocked · registration expired");
    expect(fi).not.toContain("data-reg-line");
  });

  it("[T-1113] Action needed with its open count; Not checked yet in grey text; a market not sold is inert", () => {
    const html = render();
    expect(text(html)).toContain("Action needed · 2 open");
    const never = html.match(/<div role="gridcell" data-node="EU-DE" data-cell="never"[\s\S]*?<\/a><\/div>/)![0];
    expect(text(never)).toContain("Not checked yet");
    expect(never).toContain(`href="/w/${WS}/products/${P2}"`);
    expect(html).toContain('data-cell="none"');
    expect(text(html)).toContain("Not a market for this product");
  });

  it("[S-MTX-004] a market outside the plan: disabled cells, Not in your plan and Upgrade in its header", () => {
    const html = render();
    expect(html).toMatch(/<div role="gridcell" aria-disabled="true" data-node="US-TX" data-cell="locked"/);
    expect(text(html)).toContain("Not in your plan · Upgrade");
    expect(html).toContain(`href="/w/${WS}/billing/plans"`);
  });

  it("[T-1113] counts only: 'n of m products label clear' per column and markets per row, no score or percentage", () => {
    const html = text(render());
    // Germany: Salmon has open items and the cat was never checked there, so 0 of the 1 product checked is label clear.
    expect(html).toContain("0 of 1 products label clear");
    expect(html).toContain("1 of 1 products label clear");
    expect(html).toContain("1 market with open items · 1 blocked");
    expect(html).not.toContain("%");
  });

  it("[T-1113] one cell is in the tab order (roving tabindex); arrows move between the rest", () => {
    const html = render();
    expect(html.match(/tabindex="0"/gi)).toHaveLength(1);
    expect(html).toContain('role="grid"');
    expect(html).toMatch(/<a [^>]*data-nav="" data-r="0" data-c="1" tabindex="0"/i);
  });

  it("[S-MTX-006] compact density: one-line cells, the registration as its glyph, row details for screen readers", () => {
    const full = render(page({ filters: { density: "compact" } }));
    const html = full.slice(full.indexOf('role="grid"'), full.indexOf('data-region="cards"')); // the phone's cards are not dense
    expect(html).toContain('data-density="compact"');
    expect(html).not.toContain("data-reg-line");
    expect(html).toContain('title="Registration: Unknown"');
    expect(text(html)).toContain("Blocked");
    expect(html).not.toContain("data-row-summary");
  });

  it("[S-MTX-005] filtered: 'Showing n of N products · Clear filters'", () => {
    expect(text(render(page({ filters: { state: "blocked" } })))).toContain("Showing 1 of 2 products · Clear filters");
  });

  it("[T-1113] Add a product and Upload a label only for people who may create products", () => {
    expect(render()).not.toContain("Add a product");
    const html = render(page({ canCreate: true }));
    expect(html).toContain(`href="/w/${WS}/products/new"`);
    expect(html).toContain(`href="/w/${WS}/products/new#start-from-label"`);
  });

  it("[S-MTX-008] no products yet", () => {
    const html = text(render(page({ empty: true, canCreate: true })));
    expect(html).toContain("Add a product to see it against every market");
    expect(text(render(page({ empty: true })))).not.toContain("Upload a label");
  });

  it("[S-MTX-009] loading shows the outline and says so, in no state's colour", () => {
    const html = renderToStaticMarkup(<BoardLoading />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the board…");
    expect(html).not.toMatch(/(text|bg)-(clear|action|blocked|na)\b/);
  });

  it("[S-MTX-010] the error reference is the response's request id, never a made-up one", () => {
    const html = renderToStaticMarkup(<BoardError retryHref={`/w/${WS}/board`} requestId="req-12345678" />);
    expect(html).toContain("The board didn’t load");
    expect(text(html)).toContain("Error reference · req-12345678");
    expect(html).toContain(`href="/w/${WS}/board"`);
    expect(renderToStaticMarkup(<BoardError retryHref="/" requestId={null} />)).not.toContain("Error reference");
  });

  it("[S-MTX-011] no permission, with no Request access", () => {
    const html = renderToStaticMarkup(<BoardNoAccess />);
    expect(html).toContain("You don’t have access to this workspace’s board");
    expect(html).not.toMatch(/request access/i);
  });
});
