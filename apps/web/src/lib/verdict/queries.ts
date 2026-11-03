// S-MOB-003 The verdict: the reads, under the person's own session (RLS decides what any of them returns).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildVerdict, type Verdict } from "./model";

export class VerdictReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the verdict (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "VerdictReadError";
  }
}

export type VerdictPage =
  | { kind: "not-found" }
  | { kind: "no-market"; product: { id: string; name: string } }
  | { kind: "loaded"; product: { id: string; name: string }; verdict: Verdict };

type Client = SupabaseClient<Database>;

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new VerdictReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE = /^[A-Z]{2,3}(-[A-Z0-9]{2,3})?$/;
const none = { data: [], error: null };

export async function readVerdict(supabase: Client, workspaceId: string, productId: string, nodeId: string): Promise<VerdictPage> {
  if (!UUID.test(workspaceId) || !UUID.test(productId)) return { kind: "not-found" };
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");

  const product = ok(
    "product",
    await app.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle(),
  );
  if (!product) return { kind: "not-found" };
  if (!NODE.test(nodeId)) return { kind: "no-market", product };

  const jurisdictions =
    ok("markets", await ref.from("jurisdictions").select("id, name, parent_id").or(`id.eq.${nodeId},parent_id.eq.${nodeId}`)) ?? [];
  if (!jurisdictions.some((j) => j.id === nodeId)) return { kind: "no-market", product };
  const nodeIds = jurisdictions.map((j) => j.id);

  const [nodeRows, rollup, current] = await Promise.all([
    app
      .from("product_nodes")
      .select("node_id, label_state, registration_state, display_state, open_actions, last_check_job_id")
      .eq("product_id", productId)
      .in("node_id", nodeIds),
    app.rpc("rollup_state", { p_product: productId, p_node: nodeId }),
    ref.from("ruleset_versions").select("id").not("released_at", "is", null).order("released_at", { ascending: false }).limit(1),
  ]);
  const nodes = ok("markets", nodeRows) ?? [];
  if (!nodes.length) return { kind: "no-market", product };
  const jobIds = [...new Set(nodes.map((n) => n.last_check_job_id).filter((j): j is string => !!j))];

  const checks =
    ok(
      "checks",
      jobIds.length
        ? await app
            .from("checks")
            .select("id, job_id, node_id, label_state, ruleset_version, artwork_sha, at")
            .eq("product_id", productId)
            .in("node_id", nodeIds)
            .in("job_id", jobIds)
        : none,
    ) ?? [];
  const findings =
    ok(
      "findings",
      checks.length
        ? await app
            .from("check_findings")
            .select("id, check_id, node_id, rule_key, gap_id, state, kind, provenance, citation, message, recommended_action, confidence")
            .in("check_id", checks.map((c) => c.id))
        : none,
    ) ?? [];
  const gapIds = [...new Set(findings.map((f) => f.gap_id).filter((g): g is string => !!g))];
  const gaps = ok("gaps", gapIds.length ? await ref.from("coverage_gaps").select("gap_id, node_id").in("gap_id", gapIds) : none) ?? [];

  const verdict = buildVerdict({
    workspaceId,
    productId,
    nodeId,
    jurisdictions,
    nodes,
    rollup: ok("roll-up", rollup),
    checks,
    findings,
    gaps,
    currentRuleset: ok("ruleset", current)?.[0]?.id ?? null,
  });
  if (!verdict) return { kind: "no-market", product };
  return { kind: "loaded", product, verdict };
}
