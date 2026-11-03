// S-NV2-006 Board (F01) and portfolio findings (F04): the reads, under the person's own session, so RLS decides what
// any of them returns (a family- or market-scoped member sees only their products and markets). The board never
// rolls a state up itself: region cells are app.rollup_state(product, region) (BE-15), called once per product ×
// region the product is sold in. That is one call per pair, which the 300-recipe budget will want as one
// set-returning function in the database (#56 question 5); until then the calls run a few at a time.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { GapRow } from "@/lib/report/model";
import {
  buildBoard,
  buildFindings,
  type BoardFilters,
  type BoardJurisdictionRow,
  type BoardModel,
  type BoardNodeRow,
  type BoardProductRow,
  type PortfolioFindingRow,
  type PortfolioFindings,
  type RollupRow,
  type RulesetRow,
} from "./model";

type Client = SupabaseClient<Database>;

export class BoardReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the board (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "BoardReadError";
  }
}

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

function ok<T>(what: string, r: Result<T>): T {
  if (r.error) throw new BoardReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000; // PostgREST's max_rows (supabase/config.toml)
const BATCH = 60; // ids per `in` filter, so a URL stays short
const ROLLUP_CONCURRENCY = 8;
/** At most this many open findings are read for the findings view; the view says when there were more. */
export const FINDINGS_READ_CAP = 5000;

/** Every row of a query, a page at a time, up to `cap`. */
async function paged<T>(what: string, query: (from: number, to: number) => PromiseLike<Result<T[]>>, cap = Infinity): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const page = ok(what, await query(from, from + PAGE - 1)) ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out.slice(0, cap);
}

function batches<T>(xs: T[], size = BATCH): T[][] {
  return Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
}

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await f(xs[i]);
      }
    }),
  );
  return out;
}

export type BoardPage =
  | { kind: "not-found" }
  | { kind: "loaded"; board: BoardModel; findings: (PortfolioFindings & { capped: boolean }) | null };

type BaseRows = {
  products: BoardProductRow[];
  nodes: BoardNodeRow[];
  jurisdictions: BoardJurisdictionRow[];
  rulesets: RulesetRow[];
};

async function readBase(supabase: Client, workspaceId: string): Promise<BaseRows> {
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");
  const [products, nodes, jurisdictions, rulesets] = await Promise.all([
    paged<BoardProductRow>("products", (from, to) =>
      app
        .from("products")
        .select("id, name, stage, species, life_stage, format")
        .eq("workspace_id", workspaceId)
        .neq("stage", "discontinued") // F01 step 3: discontinued products are not on the board
        .order("id")
        .range(from, to),
    ),
    paged<BoardNodeRow>("markets", (from, to) =>
      app
        .from("product_nodes")
        .select("product_id, node_id, display_state, ruleset_version, open_actions, last_check_job_id")
        .eq("workspace_id", workspaceId)
        .order("product_id")
        .order("node_id")
        .range(from, to),
    ),
    paged<BoardJurisdictionRow>("jurisdictions", (from, to) =>
      ref.from("jurisdictions").select("id, name, parent_id, node_type").order("id").range(from, to),
    ),
    paged<RulesetRow>("rulesets", (from, to) =>
      ref.from("ruleset_versions").select("id, released_at").not("released_at", "is", null).order("id").range(from, to),
    ),
  ]);
  return { products, nodes, jurisdictions, rulesets };
}

/** app.rollup_state for every product × region the product is sold in. */
async function readRollups(supabase: Client, base: BaseRows): Promise<RollupRow[]> {
  const live = new Set(base.products.map((p) => p.id));
  const parent = new Map(base.jurisdictions.map((j) => [j.id, j.parent_id]));
  const pairs = new Map<string, { product_id: string; region_id: string }>();
  for (const n of base.nodes) {
    const region = parent.get(n.node_id);
    if (!live.has(n.product_id) || !region) continue;
    pairs.set(`${n.product_id}|${region}`, { product_id: n.product_id, region_id: region });
  }
  const app = supabase.schema("app");
  return pool([...pairs.values()], ROLLUP_CONCURRENCY, async (p) => ({
    ...p,
    state: ok("roll-up", await app.rpc("rollup_state", { p_product: p.product_id, p_node: p.region_id })),
  }));
}

/** F04: the open findings of each market's latest check job, with the coverage gaps they cite. */
async function readFindings(supabase: Client, base: BaseRows): Promise<{ rows: PortfolioFindingRow[]; gaps: GapRow[]; capped: boolean }> {
  const live = new Set(base.products.map((p) => p.id));
  const jobs = [...new Set(base.nodes.filter((n) => live.has(n.product_id)).map((n) => n.last_check_job_id).filter((j): j is string => !!j))];
  const app = supabase.schema("app");
  const rows: PortfolioFindingRow[] = [];
  let capped = false;
  for (const batch of batches(jobs)) {
    const left = FINDINGS_READ_CAP - rows.length;
    if (left <= 0) {
      capped = true;
      break;
    }
    const read = await paged<PortfolioFindingRow>(
      "findings",
      (from, to) =>
        app
          .from("check_findings")
          .select(
            "id, check_id, product_id, node_id, rule_key, gap_id, state, provenance, citation, message, recommended_action, " +
              "text_object_id, bbox_mm, measured_mm, required_mm, reason_code, created_at, checks!inner(job_id)",
          )
          .in("checks.job_id", batch)
          .in("state", ["action", "not_assessed"])
          .order("id")
          .range(from, to) as unknown as PromiseLike<Result<PortfolioFindingRow[]>>,
      left + 1,
    );
    if (read.length > left) capped = true;
    rows.push(...read.slice(0, left));
  }
  const gapIds = [...new Set(rows.map((f) => f.gap_id).filter((g): g is string => !!g))];
  const ref = supabase.schema("ref");
  const gaps = (
    await Promise.all(
      batches(gapIds).map(
        async (b) =>
          ok("gaps", await ref.from("coverage_gaps").select("gap_id, node_id, domain, reason_code, description").in("gap_id", b)) ?? [],
      ),
    )
  ).flat() as GapRow[];
  return { rows, gaps, capped };
}

export async function readBoard(supabase: Client, workspaceId: string, filters: BoardFilters): Promise<BoardPage> {
  if (!UUID.test(workspaceId)) return { kind: "not-found" };
  const base = await readBase(supabase, workspaceId);
  const rows = { workspaceId, ...base, filters };
  if (filters.view === "findings") {
    const read = await readFindings(supabase, base);
    const board = buildBoard({ ...rows, rollups: [] });
    return { kind: "loaded", board, findings: { ...buildFindings(rows, read.rows, read.gaps), capped: read.capped } };
  }
  const rollups = await readRollups(supabase, base);
  return { kind: "loaded", board: buildBoard({ ...rows, rollups }), findings: null };
}
