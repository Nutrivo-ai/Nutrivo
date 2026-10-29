// S-NV2-003 Label report: the reads, under the person's own session (RLS decides what any of them returns). The
// product's markets name their latest check job (app.product_nodes.last_check_job_id, written by the check handler with
// the checks themselves), so the report shows one job's results per market and never mixes an older one in.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildReport, type ReportModel } from "./model";

export class ReportReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the label report (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "ReportReadError";
  }
}

export type ReportPage =
  | { kind: "not-found" }
  | { kind: "loaded"; product: { id: string; name: string }; markets: number; report: ReportModel };

type Client = SupabaseClient<Database>;

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new ReportReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readReport(supabase: Client, workspaceId: string, productId: string): Promise<ReportPage> {
  if (!UUID.test(workspaceId) || !UUID.test(productId)) return { kind: "not-found" };
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");

  const product = ok(
    "product",
    await app.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle(),
  );
  if (!product) return { kind: "not-found" };

  const [nodes, current] = await Promise.all([
    app.from("product_nodes").select("node_id, last_check_job_id").eq("product_id", productId),
    ref.from("ruleset_versions").select("id").not("released_at", "is", null).order("released_at", { ascending: false }).limit(1),
  ]);
  const marketRows = ok("markets", nodes) ?? [];
  const currentRuleset = ok("ruleset", current)?.[0]?.id ?? null;
  const nodeIds = marketRows.map((m) => m.node_id);
  const jobIds = [...new Set(marketRows.map((m) => m.last_check_job_id).filter((j): j is string => !!j))];

  const [names, checkRows] = await Promise.all([
    nodeIds.length ? ref.from("jurisdictions").select("id, name").in("id", nodeIds) : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? app
          .from("checks")
          .select("id, job_id, node_id, panel_id, language, label_state, ruleset_version, artwork_version_id, artwork_sha, at")
          .eq("product_id", productId)
          .in("job_id", jobIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const nameOf = new Map((ok("markets", names) ?? []).map((j) => [j.id, j.name]));
  const checks = ok("checks", checkRows) ?? [];
  const checkIds = checks.map((c) => c.id);
  const panelIds = [...new Set(checks.map((c) => c.panel_id).filter((p): p is string => !!p))];

  const [findingRows, panelRows, objectRows] = await Promise.all([
    checkIds.length
      ? app
          .from("check_findings")
          .select(
            "id, check_id, node_id, rule_key, gap_id, state, provenance, citation, message, recommended_action, text_object_id, bbox_mm, measured_mm, required_mm, reason_code, created_at",
          )
          .in("check_id", checkIds)
      : Promise.resolve({ data: [], error: null }),
    panelIds.length
      ? app.from("artwork_panels").select("id, page, panel_index, bbox_mm, language, status, failure_code").in("id", panelIds)
      : Promise.resolve({ data: [], error: null }),
    panelIds.length
      ? app.from("text_objects").select("id, panel_id, text, bbox_mm, is_ocr, reading_order").in("panel_id", panelIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const findings = ok("findings", findingRows) ?? [];
  const gapIds = [...new Set(findings.map((f) => f.gap_id).filter((g): g is string => !!g))];
  const gapRows = gapIds.length
    ? await ref.from("coverage_gaps").select("gap_id, node_id, domain, reason_code, description").in("gap_id", gapIds)
    : { data: [], error: null };

  const report = buildReport({
    workspaceId,
    markets: marketRows.map((m) => ({ node_id: m.node_id, name: nameOf.get(m.node_id) ?? m.node_id, last_check_job_id: m.last_check_job_id })),
    checks,
    findings,
    panels: ok("panels", panelRows) ?? [],
    textObjects: ok("text", objectRows) ?? [],
    gaps: ok("gaps", gapRows) ?? [],
    currentRuleset,
  });
  return { kind: "loaded", product, markets: marketRows.length, report };
}
