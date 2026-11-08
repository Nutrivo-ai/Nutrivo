// S-NV2-006 Board (F01) and the portfolio findings on it (F04): the rows a workspace's products hold, read under RLS,
// shaped into what the screen shows. Pure, so the must-holds are tested without a database:
// - the model never computes a state. A market cell is app.product_nodes.display_state (BE-14: an unknown or lapsed
//   registration never reads Clear); a region cell is app.rollup_state(product, region) as the database answered it
//   (BE-15: a parent is never better than its worst child, computed in the database, F01.must.1);
// - anything the vocabulary does not know, and a region whose roll-up was not read, is Not assessed, never Clear;
// - a market a product is not sold in is no state at all, so it can never pass for Clear either;
// - discontinued products are not on the board (F01 step 3);
// - a finding reads as in its label report (findingOf): only the latest check job of each market, an action with its
//   rule, a withheld finding with its gap or the statement that none was recorded.
import type { VerdictState } from "@/components/kit/states";
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
  display_state: string | null;
  ruleset_version: string | null;
  open_actions: number;
  last_check_job_id: string | null;
};
export type BoardJurisdictionRow = { id: string; name: string; parent_id: string | null; node_type: string };
export type RulesetRow = { id: string; released_at: string | null };
/** app.rollup_state(product, region), one per product × region the product is sold in. */
export type RollupRow = { product_id: string; region_id: string; state: string | null };

export const STATE_FILTERS = ["action", "not_assessed", "stale"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
export type BoardView = "board" | "findings";
export type BoardFilters = { state: StateFilter | null; species: string | null; view: BoardView };

/** The board's filters from the URL. Unknown values are ignored rather than guessed. */
export function parseFilters(params: Record<string, string | string[] | undefined>): BoardFilters {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : null;
  };
  const state = one("state");
  const species = one("species");
  return {
    state: (STATE_FILTERS as readonly string[]).includes(state ?? "") ? (state as StateFilter) : null,
    species: species && /^[a-z_]{1,32}$/.test(species) ? species : null,
    view: one("view") === "findings" ? "findings" : "board",
  };
}

/** The board's URL for a set of filters; null values are left out. */
export function boardHref(workspaceId: string, f: Partial<BoardFilters>): string {
  const q = new URLSearchParams();
  if (f.view === "findings") q.set("view", "findings");
  if (f.state) q.set("state", f.state);
  if (f.species) q.set("species", f.species);
  const s = q.toString();
  return `/w/${workspaceId}/board${s ? `?${s}` : ""}`;
}

export function asState(s: string | null | undefined): VerdictState {
  if (s === "clear" || s === "action" || s === "not_assessed" || s === "blocked") return s;
  return "not_assessed"; // anything the vocabulary does not know is withheld, never shown as a verdict
}

export type BoardColumn = {
  kind: "region" | "market";
  nodeId: string;
  regionId: string;
  /** "EU · DE" for a market, "EU" for a region. */
  label: string;
  name: string;
};
export type BoardGroup = { regionId: string; name: string; columns: BoardColumn[] };

export type BoardCell = {
  kind: "region" | "market";
  nodeId: string;
  /** null: the product is not sold here, so there is no answer to show (never Clear). */
  state: VerdictState | null;
  /** Open actions (the design's "number in cell"); null for none. */
  count: number | null;
  href: string | null;
  /** For a market: its ruleset is older than the latest release. */
  stale: boolean;
};

export type Freshness =
  | { kind: "never"; version: null; note: string }
  | { kind: "current" | "stale"; version: string; note: string };

export type BoardRow = {
  productId: string;
  name: string;
  meta: string;
  href: string;
  cells: BoardCell[];
  freshness: Freshness;
};

export type BoardModel = {
  groups: BoardGroup[];
  columns: BoardColumn[];
  /** The rows the filters keep. */
  rows: BoardRow[];
  /** Every product on the board, before filters. */
  productCount: number;
  /** Markets the board has a column for. */
  marketCount: number;
  stats: { unproven: number; stale: number };
  currentRuleset: string | null;
  species: string[];
  filters: BoardFilters;
};

export type BoardRows = {
  workspaceId: string;
  products: BoardProductRow[];
  nodes: BoardNodeRow[];
  jurisdictions: BoardJurisdictionRow[];
  rollups: RollupRow[];
  rulesets: RulesetRow[];
  filters: BoardFilters;
};

export function productHref(workspaceId: string, productId: string): string {
  return `/w/${workspaceId}/products/${productId}`;
}

export function cellHref(workspaceId: string, productId: string, nodeId: string): string {
  return `/w/${workspaceId}/products/${productId}/nodes/${encodeURIComponent(nodeId)}`;
}

/** The latest released ruleset: what "current" means on the board. */
export function currentRuleset(rulesets: RulesetRow[]): string | null {
  const released = rulesets.filter((r) => r.released_at);
  released.sort((a, b) => (b.released_at! < a.released_at! ? -1 : b.released_at! > a.released_at! ? 1 : 0));
  return released[0]?.id ?? null;
}

function isStale(n: BoardNodeRow, current: string | null): boolean {
  return !!n.ruleset_version && !!current && n.ruleset_version !== current;
}

/** Markets grouped by their region, each group led by its region column (F01 steps 1 and 2; #56 question 1). */
export function columnsOf(nodes: BoardNodeRow[], jurisdictions: BoardJurisdictionRow[]): BoardGroup[] {
  const byId = new Map(jurisdictions.map((j) => [j.id, j]));
  const regionOf = (id: string) => {
    const j = byId.get(id);
    return j?.parent_id ?? (j?.node_type === "region" ? j.id : null);
  };
  const markets = new Map<string, Set<string>>();
  for (const n of nodes) {
    const j = byId.get(n.node_id);
    if (!j || j.node_type === "region") continue; // a region itself is read through its roll-up cell
    const region = regionOf(n.node_id);
    if (!region) continue;
    if (!markets.has(region)) markets.set(region, new Set());
    markets.get(region)!.add(n.node_id);
  }
  return [...markets.keys()].sort().map((regionId) => {
    const region = byId.get(regionId);
    const name = region?.name ?? regionId;
    return {
      regionId,
      name,
      columns: [
        { kind: "region" as const, nodeId: regionId, regionId, label: regionId, name: `${name}, rolled up over the markets you can see` },
        ...[...markets.get(regionId)!].sort().map((id) => ({
          kind: "market" as const,
          nodeId: id,
          regionId,
          label: `${regionId} · ${nodeCode(id)}`,
          name: byId.get(id)?.name ?? id,
        })),
      ],
    };
  });
}

function metaOf(p: BoardProductRow): string {
  const who = [p.species, p.life_stage].filter(Boolean).join(", ");
  return [p.format, who].filter(Boolean).join(" · ") || p.stage.replace(/_/g, " ");
}

function freshnessOf(nodes: BoardNodeRow[], current: string | null, released: Map<string, string | null>): Freshness {
  const checked = nodes.filter((n) => n.ruleset_version);
  if (!checked.length) return { kind: "never", version: null, note: "never run" };
  const notRun = nodes.length - checked.length;
  const stale = checked.filter((n) => isStale(n, current));
  if (stale.length) {
    // The oldest ruleset any market was judged against is what the row is only as good as.
    const oldest = stale
      .map((n) => n.ruleset_version!)
      .sort((a, b) => (released.get(a) ?? a).localeCompare(released.get(b) ?? b))[0];
    return { kind: "stale", version: oldest, note: `stale · ${stale.length} of ${nodes.length} markets` };
  }
  return { kind: "current", version: checked[0].ruleset_version!, note: notRun ? `current · ${notRun} not run` : "current" };
}

export function buildBoard(rows: BoardRows): BoardModel {
  const { workspaceId, filters } = rows;
  const products = rows.products.filter((p) => p.stage !== "discontinued");
  const productIds = new Set(products.map((p) => p.id));
  const nodes = rows.nodes.filter((n) => productIds.has(n.product_id));
  const current = currentRuleset(rows.rulesets);
  const released = new Map(rows.rulesets.map((r) => [r.id, r.released_at]));
  const groups = columnsOf(nodes, rows.jurisdictions);
  const columns = groups.flatMap((g) => g.columns);
  const regionOf = new Map(columns.filter((c) => c.kind === "market").map((c) => [c.nodeId, c.regionId]));
  const rollup = new Map(rows.rollups.map((r) => [`${r.product_id}|${r.region_id}`, r.state]));
  const nodesOf = new Map<string, BoardNodeRow[]>();
  for (const n of nodes) {
    if (!nodesOf.has(n.product_id)) nodesOf.set(n.product_id, []);
    nodesOf.get(n.product_id)!.push(n);
  }

  let unproven = 0;
  let stale = 0;
  const all: { row: BoardRow; product: BoardProductRow; marketStates: VerdictState[]; anyStale: boolean }[] = [];
  for (const p of [...products].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const own = nodesOf.get(p.id) ?? [];
    const byNode = new Map(own.map((n) => [n.node_id, n]));
    const marketStates: VerdictState[] = [];
    const cells: BoardCell[] = columns.map((c) => {
      if (c.kind === "market") {
        const n = byNode.get(c.nodeId);
        if (!n) return { kind: "market", nodeId: c.nodeId, state: null, count: null, href: null, stale: false };
        const state = asState(n.display_state);
        marketStates.push(state);
        if (state === "not_assessed") unproven++;
        const s = isStale(n, current);
        if (s) stale++;
        return {
          kind: "market",
          nodeId: c.nodeId,
          state,
          count: n.open_actions > 0 ? n.open_actions : null,
          href: cellHref(workspaceId, p.id, c.nodeId),
          stale: s,
        };
      }
      const inRegion = own.filter((n) => regionOf.get(n.node_id) === c.regionId);
      if (!inRegion.length) return { kind: "region", nodeId: c.nodeId, state: null, count: null, href: null, stale: false };
      const actions = inRegion.reduce((sum, n) => sum + n.open_actions, 0);
      return {
        kind: "region",
        nodeId: c.nodeId,
        // The database's roll-up as returned; one that was not read is withheld, never Clear.
        state: asState(rollup.get(`${p.id}|${c.regionId}`)),
        count: actions > 0 ? actions : null,
        href: cellHref(workspaceId, p.id, c.nodeId),
        stale: false,
      };
    });
    all.push({
      product: p,
      marketStates,
      anyStale: own.some((n) => isStale(n, current)),
      row: {
        productId: p.id,
        name: p.name,
        meta: metaOf(p),
        href: productHref(workspaceId, p.id),
        cells,
        freshness: freshnessOf(own, current, released),
      },
    });
  }

  const kept = all.filter(({ product, marketStates, anyStale }) => {
    if (filters.species && product.species !== filters.species) return false;
    if (filters.state === "stale") return anyStale;
    if (filters.state) return marketStates.includes(filters.state);
    return true;
  });

  return {
    groups,
    columns,
    rows: kept.map((k) => k.row),
    productCount: products.length,
    marketCount: columns.filter((c) => c.kind === "market").length,
    stats: { unproven, stale },
    currentRuleset: current,
    species: [...new Set(products.map((p) => p.species).filter((s): s is string => !!s))].sort(),
    filters,
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
  rows: Pick<BoardRows, "workspaceId" | "products" | "nodes" | "rulesets" | "filters" | "jurisdictions">,
  findings: PortfolioFindingRow[],
  gaps: GapRow[],
  limit = FINDINGS_SHOWN,
): PortfolioFindings {
  const { workspaceId, filters } = rows;
  const products = new Map(rows.products.filter((p) => p.stage !== "discontinued").map((p) => [p.id, p]));
  const current = currentRuleset(rows.rulesets);
  const node = new Map(rows.nodes.map((n) => [`${n.product_id}|${n.node_id}`, n]));
  const parent = new Map(rows.jurisdictions.map((j) => [j.id, j.parent_id]));
  const gapMap = new Map(gaps.map((g) => [g.gap_id, g]));

  const open = findings.filter((f) => {
    if (f.state !== "action" && f.state !== "not_assessed") return false;
    const p = products.get(f.product_id);
    const n = node.get(`${f.product_id}|${f.node_id}`);
    // Only the market's latest check job: an older job's result is never mixed in (as the label report reads it).
    if (!p || !n || !n.last_check_job_id || f.checks?.job_id !== n.last_check_job_id) return false;
    if (filters.species && p.species !== filters.species) return false;
    if (filters.state === "stale") return isStale(n, current);
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
