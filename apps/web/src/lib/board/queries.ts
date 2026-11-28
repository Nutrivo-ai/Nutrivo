// S-MTX-001 Board as the product matrix (F01) and portfolio findings (F04): the reads, under the person's own session,
// so RLS decides what any of them returns (a family- or market-scoped member sees only their products and markets).
// The matrix rolls nothing up: each cell is one app.product_nodes row as stored (label_state, registration_state and
// the generated display_state); a region's roll-up is the database's (app.rollup_state, BE-15), shown on S-MOB-002.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildPlan, inPlan, regionName, type Plan } from "@/lib/plan/regions";
import type { GapRow } from "@/lib/report/model";
import {
  buildBoard,
  buildFindings,
  FINDINGS_READ_CAP,
  type BoardFilters,
  type BoardJurisdictionRow,
  type BoardModel,
  type BoardNodeRow,
  type BoardProductRow,
  type PortfolioFindingRow,
  type PortfolioFindings,
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

export type BoardPage =
  | { kind: "not-found" }
  | {
      kind: "loaded";
      board: BoardModel;
      workspaceName: string;
      /**
       * Add a product and Upload a label show only to people who may create products: the conditions of
       * private.can_create_product (an internal, unscoped admin, portfolio manager or editor), read from the person's
       * own membership. Presentation only: create_product checks it again.
       */
      canCreate: boolean;
      /** outsidePlan: J04.must.1 (T-902), the regions whose findings are not shown because the plan does not hold them. */
      findings: (PortfolioFindings & { capped: boolean; outsidePlan: string[] }) | null;
    };

type BaseRows = {
  products: BoardProductRow[];
  nodes: BoardNodeRow[];
  jurisdictions: BoardJurisdictionRow[];
  workspace: { name: string; entitled_regions: string[] | null } | null;
  canCreate: boolean;
};

type MembershipRow = {
  role: string;
  is_external: boolean;
  scope_family_ids: string[] | null;
  scope_node_ids: string[] | null;
  access_ends_at: string | null;
};

async function readCanCreate(supabase: Client, workspaceId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const app = supabase.schema("app");
  const person = ok("person", await app.from("people").select("id").eq("user_id", auth.user.id).maybeSingle());
  if (!person) return false;
  const m = ok(
    "membership",
    await app
      .from("memberships")
      .select("role, is_external, scope_family_ids, scope_node_ids, access_ends_at")
      .eq("workspace_id", workspaceId)
      .eq("person_id", person.id)
      .is("ended_at", null)
      .maybeSingle(),
  ) as MembershipRow | null;
  return (
    !!m &&
    ["admin", "portfolio_manager", "editor"].includes(m.role) &&
    !m.is_external &&
    m.scope_family_ids === null &&
    m.scope_node_ids === null &&
    (m.access_ends_at === null || new Date(m.access_ends_at) > new Date())
  );
}

async function readBase(supabase: Client, workspaceId: string): Promise<BaseRows> {
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");
  const [products, nodes, jurisdictions, workspace, canCreate] = await Promise.all([
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
        .select("product_id, node_id, label_state, registration_state, display_state, ruleset_version, open_actions, last_check_job_id")
        .eq("workspace_id", workspaceId)
        .order("product_id")
        .order("node_id")
        .range(from, to),
    ),
    paged<BoardJurisdictionRow>("jurisdictions", (from, to) =>
      ref.from("jurisdictions").select("id, name, parent_id, node_type").order("id").range(from, to),
    ),
    app.from("workspaces").select("name, entitled_regions").eq("id", workspaceId).maybeSingle(),
    readCanCreate(supabase, workspaceId),
  ]);
  return { products, nodes, jurisdictions, workspace: ok("workspace", workspace), canCreate };
}

/** F04: the open findings of each market's latest check job, with the coverage gaps they cite. */
async function readFindings(
  supabase: Client,
  base: BaseRows,
  plan: Plan,
): Promise<{ rows: PortfolioFindingRow[]; gaps: GapRow[]; capped: boolean; outsidePlan: string[] }> {
  const live = new Set(base.products.map((p) => p.id));
  // J04.must.1: a market whose region the plan does not hold has its findings neither read nor shown.
  const held = base.nodes.filter((n) => live.has(n.product_id) && inPlan(plan, n.node_id));
  const outsidePlan = [...new Set(base.nodes.filter((n) => live.has(n.product_id) && !inPlan(plan, n.node_id)).map((n) => regionName(plan, n.node_id)))].sort();
  const jobs = [...new Set(held.map((n) => n.last_check_job_id).filter((j): j is string => !!j))];
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
              "text_object_id, bbox_mm, measured_mm, required_mm, reason_code, created_at, language, checks!inner(job_id, language)",
          )
          .in("checks.job_id", batch)
          .in("state", ["action", "not_assessed"])
          .order("id")
          .range(from, to) as unknown as PromiseLike<Result<PortfolioFindingRow[]>>,
      left + 1,
    );
    const shown = read.filter((f) => inPlan(plan, f.node_id)); // a job checks several markets at once
    if (read.length > left) capped = true;
    rows.push(...shown.slice(0, left));
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
  return { rows, gaps, capped, outsidePlan };
}

export async function readBoard(supabase: Client, workspaceId: string, filters: BoardFilters): Promise<BoardPage> {
  if (!UUID.test(workspaceId)) return { kind: "not-found" };
  const base = await readBase(supabase, workspaceId);
  if (!base.workspace) return { kind: "not-found" };
  const entitledRegions = base.workspace.entitled_regions ?? [];
  const rows = { workspaceId, products: base.products, nodes: base.nodes, jurisdictions: base.jurisdictions, entitledRegions, filters };
  const board = buildBoard(rows);
  const common = { kind: "loaded" as const, board, workspaceName: base.workspace.name, canCreate: base.canCreate };
  if (filters.view !== "findings") return { ...common, findings: null };
  const plan = buildPlan(entitledRegions, base.jurisdictions);
  const read = await readFindings(supabase, base, plan);
  return {
    ...common,
    findings: { ...buildFindings({ ...rows, filters: board.filters }, read.rows, read.gaps), capped: read.capped, outsidePlan: read.outsidePlan },
  };
}
