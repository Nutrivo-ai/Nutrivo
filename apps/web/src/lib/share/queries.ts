// S-NV2-026 Export, send, share: the reads, under the person's own session (RLS decides what any of them returns).
// The product's issued reports (app.reports, insert-only, newest first), the chosen one's languages from its pinned
// checks, its market's name, its shares (app.shares, readable where the product is), and the workspace's plan for the
// free-labels panel.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PinnedReport, ShareRow } from "./model";

export class SendReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the send screen (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "SendReadError";
  }
}

export type SendPage =
  | { kind: "not-found" }
  | { kind: "no-report"; product: { id: string; name: string } }
  | {
      kind: "loaded";
      product: { id: string; name: string };
      plan: string | null;
      reports: { id: string; ref: string; market: string | null; issuedAt: string }[];
      report: PinnedReport;
      shares: ShareRow[];
    };

type Client = SupabaseClient<Database>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new SendReadError(what, r.error);
  return r.data as T;
}

export async function readSendPage(
  supabase: Client,
  workspaceId: string,
  productId: string,
  reportId: string | null,
): Promise<SendPage> {
  if (!UUID.test(workspaceId) || !UUID.test(productId)) return { kind: "not-found" };
  const app = supabase.schema("app");
  const [productRow, workspaceRow, reportRows] = await Promise.all([
    app.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle(),
    app.from("workspaces").select("plan").eq("id", workspaceId).maybeSingle(),
    app
      .from("reports")
      .select("id, ref, node_id, created_at, ruleset_version, artwork_sha, has_not_assessed, pdf_path, check_ids")
      .eq("product_id", productId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const product = ok("product", productRow);
  if (!product) return { kind: "not-found" };
  const reports = ok("reports", reportRows) ?? [];
  if (!reports.length) return { kind: "no-report", product };
  const chosen = (reportId && reports.find((r) => r.id === reportId)) || reports[0];

  const nodeIds = [...new Set(reports.map((r) => r.node_id).filter((n): n is string => !!n))];
  const [names, checks, shares] = await Promise.all([
    nodeIds.length
      ? supabase.schema("ref").from("jurisdictions").select("id, name").in("id", nodeIds)
      : Promise.resolve({ data: [], error: null }),
    chosen.check_ids.length
      ? app.from("checks").select("language").in("id", chosen.check_ids)
      : Promise.resolve({ data: [], error: null }),
    app
      .from("shares")
      .select("id, channel, recipient, expires_at, revoked_at, created_at")
      .eq("report_id", chosen.id)
      .order("created_at", { ascending: false }),
  ]);
  const nameOf = new Map((ok("markets", names) ?? []).map((j) => [j.id, j.name]));
  const languages = [
    ...new Set((ok("checks", checks) ?? []).map((c) => c.language).filter((l): l is string => !!l)),
  ].sort();
  const market = (id: string | null) => (id ? (nameOf.get(id) ?? id) : null);

  return {
    kind: "loaded",
    product,
    plan: ok("workspace", workspaceRow)?.plan ?? null,
    reports: reports.map((r) => ({ id: r.id, ref: r.ref, market: market(r.node_id), issuedAt: r.created_at })),
    report: {
      id: chosen.id,
      ref: chosen.ref,
      issuedAt: chosen.created_at,
      rulesetVersion: chosen.ruleset_version,
      artworkSha: chosen.artwork_sha,
      hasNotAssessed: chosen.has_not_assessed,
      market: market(chosen.node_id),
      languages,
      hasPdf: !!chosen.pdf_path,
    },
    shares: (ok("shares", shares) ?? []) as ShareRow[],
  };
}
