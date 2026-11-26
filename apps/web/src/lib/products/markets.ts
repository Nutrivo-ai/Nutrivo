// S-MOB-002 One recipe, its markets (Mobile design, "Read a verdict", second phone): one product and every market it is
// sold in, as a phone reads it. Pure, so its must-holds are tested without a database:
// - the model never computes a state. A market row is app.product_nodes.display_state (BE-14: an unknown or lapsed
//   registration never reads Clear); a region row is app.rollup_state(product, region) as the database answered it
//   (BE-15, F01.must.1: a parent is never better than its worst child, computed in the database). A roll-up better
//   than a market it covers is a shape error, never shown;
// - Clear is shown only when the market's latest check job has checks and all of them are clear, as the verdict
//   (S-MOB-003) decides it, so tapping a row never turns Clear into something else; anything less is Not assessed;
// - anything the vocabulary does not know, and a region whose roll-up was not read, is Not assessed, never Clear;
// - every row opens its verdict, which names the coverage gap of a Not assessed (D07.must.2, docs/04 contract 4), and
//   the label report holds one result set per language panel (D07.must.1).
import type { VerdictState } from "@/components/kit/states";

export type MarketsProductRow = { id: string; name: string; stage: string; species: string | null; life_stage: string | null; format: string | null };
export type MarketsNodeRow = {
  node_id: string;
  display_state: string | null;
  open_actions: number;
  ruleset_version: string | null;
  last_check_job_id: string | null;
};
export type MarketsJurisdictionRow = { id: string; name: string; parent_id: string | null; node_type: string };
export type MarketsCheckRow = { job_id: string | null; node_id: string; label_state: string; ruleset_version: string; at: string };
/** app.rollup_state(product, region): null when the database had no answer. */
export type MarketsRollupRow = { region_id: string; state: string | null };

export type MarketsRows = {
  workspaceId: string;
  product: MarketsProductRow;
  nodes: MarketsNodeRow[];
  jurisdictions: MarketsJurisdictionRow[];
  rollups: MarketsRollupRow[];
  checks: MarketsCheckRow[];
  currentRuleset: string | null;
};

export type MarketRow = {
  kind: "region" | "market";
  nodeId: string;
  /** "EU · Germany", "US · federal"; a region row is its code ("US"). */
  label: string;
  /** The full name: a market's own, and for a region the name of its group of rows. */
  name: string;
  state: VerdictState;
  /** What the row says beside its glyph, upper-cased by the screen: "Clear", "1 open", "Blocked". */
  value: string;
  href: string;
};

export type MarketsChecked =
  | { kind: "never"; body: string; link: { label: string; href: string } }
  | { kind: "checked"; at: string; rulesetVersion: string; current: boolean; body: string };

export type MarketsModel = {
  productId: string;
  name: string;
  kicker: string;
  /** Markets the product is sold in (regions are not counted: they roll their markets up). */
  marketCount: number;
  title: string;
  groups: { regionId: string; rows: MarketRow[] }[];
  checked: MarketsChecked;
  reportHref: string;
};

export class MarketsShapeError extends Error {
  constructor(message: string) {
    super(`product markets: ${message}`);
    this.name = "MarketsShapeError";
  }
}

const RANK: Record<VerdictState, number> = { blocked: 3, action: 2, not_assessed: 1, clear: 0 };
const VALUE: Record<VerdictState, string> = { clear: "Clear", action: "Action needed", not_assessed: "Not assessed", blocked: "Blocked" };
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function asState(s: string | null | undefined): VerdictState {
  if (s === "clear" || s === "action" || s === "not_assessed" || s === "blocked") return s;
  return "not_assessed"; // anything the vocabulary does not know is withheld, never shown as a verdict
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Three markets", "12 markets": the design's title, counted from the rows the person can read. */
export function marketsTitle(n: number): string {
  const count = n < WORDS.length ? WORDS[n] : String(n);
  return `${count} market${n === 1 ? "" : "s"}`;
}

/** "Adult dog · complete dry": what is stored about the recipe. The design's flavour is stored nowhere. */
export function kickerOf(p: MarketsProductRow): string {
  const who = [p.life_stage, p.species && p.species !== "other" ? p.species : null].filter(Boolean).join(" ");
  const kicker = [who, p.format].filter(Boolean).join(" · ");
  if (kicker) return kicker.charAt(0).toUpperCase() + kicker.slice(1);
  return p.stage.charAt(0).toUpperCase() + p.stage.slice(1).replace(/_/g, " ");
}

export function buildMarkets(rows: MarketsRows): MarketsModel {
  const { workspaceId, product } = rows;
  const base = `/w/${workspaceId}/products/${product.id}`;
  const byId = new Map(rows.jurisdictions.map((j) => [j.id, j]));
  const href = (nodeId: string) => `${base}/nodes/${encodeURIComponent(nodeId)}`;

  // Markets only: a region (or a node the tree does not know) is not a market, and is read through its roll-up.
  const markets = rows.nodes.filter((n) => {
    const j = byId.get(n.node_id);
    return !!j && j.node_type !== "region" && !!j.parent_id;
  });

  // Clear needs a latest check job, all clear (no rule, no verdict), as S-MOB-003 decides it.
  const latest = (n: MarketsNodeRow) => (n.last_check_job_id ? rows.checks.filter((c) => c.node_id === n.node_id && c.job_id === n.last_check_job_id) : []);
  const clearBacked = (n: MarketsNodeRow) => {
    const cs = latest(n);
    return cs.length > 0 && cs.every((c) => c.label_state === "clear");
  };
  const ownState = (n: MarketsNodeRow): VerdictState => {
    const s = asState(n.display_state);
    return s === "clear" && !clearBacked(n) ? "not_assessed" : s;
  };
  const valueOf = (state: VerdictState, open: number) => (state === "action" && open > 0 ? `${open} open` : VALUE[state]);

  const regions = [...new Set(markets.map((n) => byId.get(n.node_id)!.parent_id!))].sort();
  const groups = regions.map((regionId) => {
    const own = markets.filter((n) => byId.get(n.node_id)!.parent_id === regionId).sort((a, b) => a.node_id.localeCompare(b.node_id));
    const marketRows: MarketRow[] = own.map((n) => {
      const j = byId.get(n.node_id)!;
      const state = ownState(n);
      const short = j.node_type === "federal" ? "federal" : j.name;
      return {
        kind: "market",
        nodeId: n.node_id,
        label: `${regionId} · ${short}`,
        name: j.name,
        state,
        value: valueOf(state, n.open_actions),
        href: href(n.node_id),
      };
    });
    // The region's row is the database's roll-up (BE-15). Never better than a market it covers: that is a shape
    // error to surface, not a better answer to show. A roll-up the database did not give is Not assessed.
    const read = rows.rollups.find((r) => r.region_id === regionId);
    let state = asState(read?.state ?? null);
    const worst = own.reduce((w, n) => Math.max(w, RANK[asState(n.display_state)]), 0);
    if (RANK[state] < worst) throw new MarketsShapeError(`roll-up of ${regionId} (${read?.state}) is better than a market it covers`);
    if (state === "clear" && !own.every(clearBacked)) state = "not_assessed";
    const open = own.filter((n) => ownState(n) === "action").reduce((s, n) => s + n.open_actions, 0);
    const regionName = byId.get(regionId)?.name ?? regionId;
    const regionRow: MarketRow = {
      kind: "region",
      nodeId: regionId,
      label: regionId,
      name: `${regionName}, rolled up over its markets`,
      state,
      value: valueOf(state, open),
      href: href(regionId),
    };
    return { regionId, rows: [regionRow, ...marketRows] };
  });

  // Checked: the latest check behind the markets, pinned to its ruleset (CLAUDE.md non-negotiable 5).
  const checked = markets.flatMap(latest).sort((a, b) => b.at.localeCompare(a.at));
  const unchecked = markets.filter((n) => latest(n).length === 0).length;
  let checkedBlock: MarketsChecked;
  if (!checked.length) {
    checkedBlock = {
      kind: "never",
      body: "No check has run on this product yet, so no market has a verdict.",
      link: { label: "Upload & scope", href: `${base}/check` },
    };
  } else {
    const last = checked[0];
    const current = !!rows.currentRuleset && last.ruleset_version === rows.currentRuleset;
    const older = markets.filter((n) => latest(n).length > 0 && !!rows.currentRuleset && n.ruleset_version !== rows.currentRuleset).length;
    const day = new Date(last.at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const notes = [
      `${day} against ruleset ${last.ruleset_version}. ${current ? "Current." : "Superseded."}`,
      current && older ? `${plural(older, "market")} ${older === 1 ? "was" : "were"} checked against an older ruleset.` : "",
      unchecked ? `${plural(unchecked, "market")} ${unchecked === 1 ? "has" : "have"} no check yet.` : "",
    ];
    checkedBlock = { kind: "checked", at: last.at, rulesetVersion: last.ruleset_version, current, body: notes.filter(Boolean).join(" ") };
  }

  return {
    productId: product.id,
    name: product.name,
    kicker: kickerOf(product),
    marketCount: markets.length,
    title: marketsTitle(markets.length),
    groups,
    checked: checkedBlock,
    reportHref: `${base}/report`,
  };
}
