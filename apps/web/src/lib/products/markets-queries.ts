// S-MOB-002 One recipe, its markets: the reads, under the person's own session (RLS decides what any of them returns:
// a product in another workspace, or outside a member's scope, reads as absent). Region rows are app.rollup_state as
// the database answers it (BE-15), one call per region the product is sold in.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildMarkets, type MarketsModel, type MarketsProductRow } from "./markets";

export class MarketsReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the product's markets (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "MarketsReadError";
  }
}

export type MarketsPage =
  | { kind: "not-found" }
  | { kind: "empty"; product: { id: string; name: string } }
  | { kind: "loaded"; markets: MarketsModel };

type Client = SupabaseClient<Database>;

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new MarketsReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readMarkets(supabase: Client, workspaceId: string, productId: string): Promise<MarketsPage> {
  if (!UUID.test(workspaceId) || !UUID.test(productId)) return { kind: "not-found" };
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");

  const product: MarketsProductRow | null = ok(
    "product",
    await app.from("products").select("id, name, stage, species, life_stage, format").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle(),
  );
  if (!product) return { kind: "not-found" };

  const nodes =
    ok(
      "markets",
      await app
        .from("product_nodes")
        .select("node_id, display_state, open_actions, ruleset_version, last_check_job_id")
        .eq("product_id", productId)
        .eq("workspace_id", workspaceId)
        .order("node_id"),
    ) ?? [];
  if (!nodes.length) return { kind: "empty", product: { id: product.id, name: product.name } };

  const nodeIds = nodes.map((n) => n.node_id);
  const jurisdictions = ok("jurisdictions", await ref.from("jurisdictions").select("id, name, parent_id, node_type").in("id", nodeIds)) ?? [];
  const regions = [...new Set(jurisdictions.map((j) => j.parent_id).filter((r): r is string => !!r))];
  const regionRows = regions.length ? (ok("regions", await ref.from("jurisdictions").select("id, name, parent_id, node_type").in("id", regions)) ?? []) : [];
  const jobIds = [...new Set(nodes.map((n) => n.last_check_job_id).filter((j): j is string => !!j))];

  const [rollups, checks, current] = await Promise.all([
    Promise.all(
      regions.map(async (region) => ({
        region_id: region,
        state: ok(`roll-up of ${region}`, await app.rpc("rollup_state", { p_product: productId, p_node: region })) as string | null,
      })),
    ),
    jobIds.length
      ? app.from("checks").select("job_id, node_id, label_state, ruleset_version, at").eq("product_id", productId).in("job_id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    ref.from("ruleset_versions").select("id").not("released_at", "is", null).order("released_at", { ascending: false }).limit(1),
  ]);

  const markets = buildMarkets({
    workspaceId,
    product,
    nodes,
    jurisdictions: [...jurisdictions, ...regionRows],
    rollups,
    checks: ok("checks", checks) ?? [],
    currentRuleset: ok("ruleset", current)?.[0]?.id ?? null,
  });
  if (!markets.marketCount) return { kind: "empty", product: { id: product.id, name: product.name } };
  return { kind: "loaded", markets };
}
