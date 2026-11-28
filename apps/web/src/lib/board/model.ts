// S-MTX-001 Board as the product matrix (D-33, T-1113; F01) and the portfolio findings on it (F04): the rows a
// workspace's products hold, read under RLS, shaped into what the screen shows. Pure, so the must-holds are tested
// without a database:
// - the model never computes a state. Each cell keeps two lines that are never merged: the label line is
//   app.product_nodes.label_state (Label clear, Action needed with its open count, Not assessed) and the registration
//   line is registration_state. Only display_state = blocked (registration not_registered or expired, docs/03)
//   replaces the registration line, with the red Blocked chip naming which; the label line stays;
// - a market no check has reached (no ruleset_version) is "Not checked yet", never a state;
// - anything the vocabulary does not know is Not assessed (label) or Unknown (registration), never Clear;
// - the matrix has no region roll-up: a parent's state is the database's (BE-15, F01.must.1), shown on S-MOB-002;
// - a market a product is not sold in is an inert cell, and a market outside the plan a disabled one;
// - discontinued products are not on the board (F01 step 3);
// - a finding reads as in its label report (findingOf): only the latest check job of each market, an action with its
//   rule, a withheld finding with its gap or the statement that none was recorded.
import { findingOf, nodeCode, type FindingRow, type GapRow, type ReportFinding } from "@/lib/report/model";

export type BoardProductRow = {
  id: string;
  name: string;
  stage: string;
  species: string | null;
  life_stage: string | null;
  format: string | null;
};
export type BoardNodeRow = {
  product_id: string;
  node_id: string;
  label_state: string | null;
  registration_state: string | null;
  display_state: string | null;
  ruleset_version: string | null;
  open_actions: number;
  last_check_job_id: string | null;
};
export type BoardJurisdictionRow = { id: string; name: string; parent_id: string | null; node_type: string };

export const STATE_FILTERS = ["action", "not_assessed", "blocked"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
export type BoardView = "board" | "findings";
export type Density = "comfortable" | "compact";
/** page: 1-based, set only past the first (founder decision 25 Nov 2026, issue 311: the board pages its rows). */
export type BoardFilters = { state: StateFilter | null; market: string | null; density: Density; view: BoardView; page?: number };

/** Rows on one page of the board. At 300 recipes the full grid was 2,400 cells and missed its budget (issue 311). */
export const BOARD_PAGE = 50;

const MARKET = /^[A-Za-z0-9]{1,8}(-[A-Za-z0-9]{1,12}){0,3}$/;

/** The board's filters from the URL. Unknown values are ignored rather than guessed. */
export function parseFilters(params: Record<string, string | string[] | undefined>): BoardFilters {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : null;
  };
  const state = one("state");
  const market = one("market");
  const page = /^[1-9][0-9]{0,4}$/.test(one("page") ?? "") ? Number(one("page")) : 1;
  return {
    state: (STATE_FILTERS as readonly string[]).includes(state ?? "") ? (state as StateFilter) : null,
    market: market && MARKET.test(market) ? market : null,
    density: one("density") === "compact" ? "compact" : "comfortable",
    view: one("view") === "findings" ? "findings" : "board",
    ...(page > 1 ? { page } : {}),
  };
}

/** The board's URL for a set of filters; defaults are left out, so the plain board is /board. */
export function boardHref(workspaceId: string, f: Partial<BoardFilters>): string {
  const q = new URLSearchParams();
  if (f.view === "findings") q.set("view", "findings");
  if (f.market) q.set("market", f.market);
  if (f.state) q.set("state", f.state);
  if (f.density === "compact" && f.view !== "findings") q.set("density", "compact");
  if (f.page && f.page > 1 && f.view !== "findings") q.set("page", String(f.page));
  const s = q.toString();
  return `/w/${workspaceId}/board${s ? `?${s}` : ""}`;
}

// ── The two lines of a cell ──────────────────────────────────────────────────────────────────────────────────────

/** The label line. "never": no check has reached this market; it is not a state. */
export type LabelLine = "clear" | "action" | "not_assessed" | "never";

export const LABEL_TEXT: Record<LabelLine, string> = {
  clear: "Label clear", // never a bare "Clear" (D-33 rule 1)
  action: "Action needed",
  not_assessed: "Not assessed",
  never: "Not checked yet",
};

export function labelOf(n: Pick<BoardNodeRow, "label_state" | "ruleset_version">): LabelLine {
  if (!n.ruleset_version) return "never";
  if (n.label_state === "clear" || n.label_state === "action") return n.label_state;
  return "not_assessed"; // anything else is withheld, never shown as a verdict
}

export const REGISTRATIONS = ["registered", "not_required", "unknown", "not_registered", "expired"] as const;
export type Registration = (typeof REGISTRATIONS)[number];

export const REGISTRATION_TEXT: Record<Registration, string> = {
  registered: "Registered",
  not_required: "Not required",
  unknown: "Unknown",
  not_registered: "Not registered",
  expired: "Expired",
};

/** The design's registration glyphs; always shown with the word, except in compact density, where the cell's label says it. */
export const REGISTRATION_GLYPH: Record<Registration, string> = {
  registered: "✓",
  not_required: "–",
  unknown: "?",
  not_registered: "○",
  expired: "◷",
};

export function registrationOf(s: string | null | undefined): Registration {
  return (REGISTRATIONS as readonly string[]).includes(s ?? "") ? (s as Registration) : "unknown";
}

/** The registration that blocks sale, when display_state is blocked; null otherwise. */
export function blockedBy(n: Pick<BoardNodeRow, "display_state" | "registration_state">): "expired" | "not_registered" | null {
  if (n.display_state !== "blocked") return null;
  return registrationOf(n.registration_state) === "expired" ? "expired" : "not_registered";
}

// ── The matrix ───────────────────────────────────────────────────────────────────────────────────────────────────

export type BoardColumn = {
  nodeId: string;
  /** "DE", the market's code within its region. */
  code: string;
  name: string;
  regionId: string;
  /** Its region is outside the workspace's entitled_regions: disabled cells, Upgrade in the header. */
  locked: boolean;
  /** Products label clear in this market, of those a check reached here (every product, before filters). */
  clear: number;
  checked: number;
};

export type MarketCell = {
  kind: "market";
  nodeId: string;
  label: LabelLine;
  /** Open findings of the market's latest check, for Action needed; null for none. */
  open: number | null;
  registration: Registration;
  blocked: "expired" | "not_registered" | null;
  href: string;
  /** What a screen reader hears for the cell, the design's wording. */
  aria: string;
};
export type BoardCell =
  | MarketCell
  /** The product is not sold in this market: no answer at all. */
  | { kind: "none"; nodeId: string }
  /** The product is sold here, but the plan does not hold the market's region. */
  | { kind: "locked"; nodeId: string; aria: string };

export type BoardRow = {
  productId: string;
  name: string;
  meta: string;
  summary: string;
  /** The summary names something open (markets with open items, blocked). */
  attention: boolean;
  href: string;
  cells: BoardCell[];
};

export type BoardModel = {
  /** The columns shown (the market filter keeps one). */
  columns: BoardColumn[];
  /** Every market column, for the market filter. */
  markets: BoardColumn[];
  /** The rows the filters keep, on this page (BOARD_PAGE at most). */
  rows: BoardRow[];
  /** Rows the filters keep, on every page. */
  matched: number;
  /** This page (1-based, clamped to the last) and how many there are; 1 of 1 when everything fits. */
  page: number;
  pages: number;
  /** Every product on the board, before filters. */
  productCount: number;
  /** Markets the board has a column for. */
  marketCount: number;
  filters: BoardFilters;
  filtered: boolean;
};

export type BoardRows = {
  workspaceId: string;
  products: BoardProductRow[];
  nodes: BoardNodeRow[];
  jurisdictions: BoardJurisdictionRow[];
  /** app.workspaces.entitled_regions. */
  entitledRegions: readonly string[];
  filters: BoardFilters;
};

export function productHref(workspaceId: string, productId: string): string {
  return `/w/${workspaceId}/products/${productId}`;
}

/** The product × market verdict (S-NV2-007). */
export function cellHref(workspaceId: string, productId: string, nodeId: string): string {
  return `/w/${workspaceId}/products/${productId}/nodes/${encodeURIComponent(nodeId)}`;
}

/** The market's coverage page (S-NV2-021), which lists its coverage gaps. */
export function coverageHref(workspaceId: string, nodeId: string): string {
  return `/w/${workspaceId}/library/coverage/${encodeURIComponent(nodeId)}`;
}

export function upgradeHref(workspaceId: string): string {
  return `/w/${workspaceId}/billing/plans`;
}

/** Where a cell goes: Not checked yet to the product page, Not assessed to the coverage gaps, a verdict to its market. */
function hrefOf(workspaceId: string, productId: string, nodeId: string, label: LabelLine): string {
  if (label === "never") return productHref(workspaceId, productId);
  if (label === "not_assessed") return coverageHref(workspaceId, nodeId);
  return cellHref(workspaceId, productId, nodeId);
}

function regionOfNode(byId: Map<string, BoardJurisdictionRow>, id: string): string {
  const j = byId.get(id);
  return j?.parent_id ?? id;
}

function metaOf(p: BoardProductRow): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const who = [p.species, p.life_stage].filter((s): s is string => !!s).map(cap).join(" · ");
  return [who, p.format].filter(Boolean).join(" · ") || cap(p.stage.replace(/_/g, " "));
}

function marketCell(workspaceId: string, product: BoardProductRow, column: BoardColumn, n: BoardNodeRow): MarketCell {
  const label = labelOf(n);
  const open = label === "action" && n.open_actions > 0 ? n.open_actions : null;
  const registration = registrationOf(n.registration_state);
  const blocked = blockedBy(n);
  const labelText = label === "action" && open ? `Action needed, ${open} open` : LABEL_TEXT[label];
  const regText = blocked ? `Blocked, ${REGISTRATION_TEXT[blocked].toLowerCase()}` : REGISTRATION_TEXT[registration];
  const next = label === "never" ? "Open the product" : label === "not_assessed" ? "Open coverage gap" : "Open the market";
  return {
    kind: "market",
    nodeId: column.nodeId,
    label,
    open,
    registration,
    blocked,
    href: hrefOf(workspaceId, product.id, column.nodeId, label),
    aria: `${product.name}, ${column.name}: ${labelText}. Registration: ${regText}. ${next}`,
  };
}

function summaryOf(cells: BoardCell[]): { summary: string; attention: boolean } {
  const markets = cells.filter((c): c is MarketCell => c.kind === "market");
  if (markets.length && markets.every((c) => c.label === "never")) return { summary: "Not checked yet", attention: false };
  const action = markets.filter((c) => c.label === "action").length;
  const blocked = markets.filter((c) => c.blocked).length;
  const parts: string[] = [];
  if (action) parts.push(`${action} ${action === 1 ? "market" : "markets"} with open items`);
  if (blocked) parts.push(`${blocked} blocked`);
  return parts.length ? { summary: parts.join(" · "), attention: true } : { summary: "No open items", attention: false };
}

function matches(cell: BoardCell, state: StateFilter): boolean {
  if (cell.kind !== "market") return false;
  if (state === "blocked") return cell.blocked !== null;
  return cell.label === state;
}

export function buildBoard(rows: BoardRows): BoardModel {
  const { workspaceId, filters } = rows;
  const products = rows.products.filter((p) => p.stage !== "discontinued");
  const productIds = new Set(products.map((p) => p.id));
  const byId = new Map(rows.jurisdictions.map((j) => [j.id, j]));
  const entitled = new Set(rows.entitledRegions);
  const nodes = rows.nodes.filter((n) => productIds.has(n.product_id) && byId.get(n.node_id)?.node_type !== "region");
  const nodeOf = new Map(nodes.map((n) => [`${n.product_id}|${n.node_id}`, n]));

  // Columns are the markets of the workspace's product_nodes; one outside the plan comes last.
  const markets: BoardColumn[] = [...new Set(nodes.map((n) => n.node_id))]
    .map((nodeId) => {
      const regionId = regionOfNode(byId, nodeId);
      const here = nodes.filter((n) => n.node_id === nodeId);
      return {
        nodeId,
        code: nodeCode(nodeId),
        name: byId.get(nodeId)?.name ?? nodeId,
        regionId,
        locked: !entitled.has(regionId),
        clear: here.filter((n) => labelOf(n) === "clear").length,
        checked: here.filter((n) => labelOf(n) !== "never").length,
      };
    })
    .sort((a, b) => Number(a.locked) - Number(b.locked) || a.regionId.localeCompare(b.regionId) || a.code.localeCompare(b.code));
  const market = filters.market && markets.some((m) => m.nodeId === filters.market && !m.locked) ? filters.market : null;
  const columns = market ? markets.filter((m) => m.nodeId === market) : markets;

  const all = [...products]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((p) => {
      const cellFor = (c: BoardColumn): BoardCell => {
        const n = nodeOf.get(`${p.id}|${c.nodeId}`);
        if (!n) return { kind: "none", nodeId: c.nodeId };
        if (c.locked) return { kind: "locked", nodeId: c.nodeId, aria: `${p.name}, ${c.name}: Not in your plan` };
        return marketCell(workspaceId, p, c, n);
      };
      const own = markets.map(cellFor);
      const cells = market ? own.filter((c) => c.nodeId === market) : own;
      return {
        cells,
        row: { productId: p.id, name: p.name, meta: metaOf(p), href: productHref(workspaceId, p.id), cells, ...summaryOf(own) },
      };
    });

  const kept = filters.state ? all.filter((r) => r.cells.some((c) => matches(c, filters.state!))) : all;
  const pages = Math.max(1, Math.ceil(kept.length / BOARD_PAGE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);
  return {
    columns,
    markets,
    rows: kept.slice((page - 1) * BOARD_PAGE, page * BOARD_PAGE).map((k) => k.row),
    matched: kept.length,
    page,
    pages,
    productCount: products.length,
    marketCount: markets.length,
    filters: { ...filters, market },
    filtered: !!filters.state || !!market,
  };
}

// ── F04 · Portfolio findings ─────────────────────────────────────────────────────────────────────────────────────

/** A finding with the job of the check it sits under (embedded from app.checks). */
export type PortfolioFindingRow = FindingRow & {
  product_id: string;
  /** The printed panel's language, when the finding names it (non-negotiable 4: results are per language panel). */
  language: string | null;
  checks: { job_id: string | null; language: string | null } | null;
};

export type PortfolioFinding = {
  productId: string;
  productName: string;
  nodeId: string;
  nodeLabel: string;
  /** The language panel the finding was judged on, upper-case; null when the check names none. */
  language: string | null;
  href: string;
  finding: Extract<ReportFinding, { state: "action" | "not_assessed" }>;
};

export type PortfolioFindings = {
  items: PortfolioFinding[];
  /** Every open finding the filters keep; items holds the first `limit` of them. */
  total: number;
  counts: { action: number; not_assessed: number };
};

export const FINDINGS_SHOWN = 100;
/** At most this many open findings are read for the findings view; the view says when there were more. */
export const FINDINGS_READ_CAP = 5000;

export function buildFindings(
  rows: Pick<BoardRows, "workspaceId" | "products" | "nodes" | "filters" | "jurisdictions">,
  findings: PortfolioFindingRow[],
  gaps: GapRow[],
  limit = FINDINGS_SHOWN,
): PortfolioFindings {
  const { workspaceId, filters } = rows;
  const products = new Map(rows.products.filter((p) => p.stage !== "discontinued").map((p) => [p.id, p]));
  const node = new Map(rows.nodes.map((n) => [`${n.product_id}|${n.node_id}`, n]));
  const parent = new Map(rows.jurisdictions.map((j) => [j.id, j.parent_id]));
  const gapMap = new Map(gaps.map((g) => [g.gap_id, g]));

  const open = findings.filter((f) => {
    if (f.state !== "action" && f.state !== "not_assessed") return false;
    const p = products.get(f.product_id);
    const n = node.get(`${f.product_id}|${f.node_id}`);
    // Only the market's latest check job: an older job's result is never mixed in (as the label report reads it).
    if (!p || !n || !n.last_check_job_id || f.checks?.job_id !== n.last_check_job_id) return false;
    if (filters.market && f.node_id !== filters.market) return false;
    if (filters.state === "blocked") return blockedBy(n) !== null;
    if (filters.state) return f.state === filters.state;
    return true;
  });
  const rank = (s: string) => (s === "action" ? 0 : 1);
  open.sort(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      products.get(a.product_id)!.name.localeCompare(products.get(b.product_id)!.name) ||
      a.node_id.localeCompare(b.node_id) ||
      a.id.localeCompare(b.id),
  );
  const items = open.slice(0, limit).map((f) => {
    const p = products.get(f.product_id)!;
    const region = parent.get(f.node_id);
    return {
      productId: p.id,
      productName: p.name,
      nodeId: f.node_id,
      nodeLabel: region ? `${region} · ${nodeCode(f.node_id)}` : f.node_id,
      language: (f.language ?? f.checks?.language)?.toUpperCase() ?? null,
      href: cellHref(workspaceId, p.id, f.node_id),
      finding: findingOf(f, "—", workspaceId, gapMap) as PortfolioFinding["finding"],
    };
  });
  return {
    items,
    total: open.length,
    counts: {
      action: open.filter((f) => f.state === "action").length,
      not_assessed: open.filter((f) => f.state === "not_assessed").length,
    },
  };
}
