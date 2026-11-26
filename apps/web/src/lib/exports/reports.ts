// I01 · Generate a report, on S-NV2-018 Exports (T-1112). One row per product × market × printed language, from the
// latest check of each, with the state of its Report of Check: issued (the app.reports row that pins the check),
// preparing or failed (the check's `report` job, key `report:<check_id>`, T-408), or none yet. Every read is under the
// person's own session, so RLS decides which products, markets, reports and jobs appear (T-409). Older reports of a
// product stay on its Export, send, share screen (S-NV2-026).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/** Checks read per page load; the latest per product × market × language is kept from these. */
export const CHECKS_READ = 500;
/** Rows the screen lists. */
export const ROWS_SHOWN = 100;

export type CheckRow = {
  id: string;
  product_id: string;
  node_id: string;
  language: string | null;
  ruleset_version: string;
  at: string;
};
export type ReportRow = {
  id: string;
  ref: string;
  check_ids: string[];
  ruleset_version: string;
  artwork_sha: string;
  pdf_path: string | null;
  created_at: string;
};
export type ReportJobRow = { id: string; idempotency_key: string; status: string; updated_at: string };

export type ReportState =
  | { kind: "issued"; reportId: string; ref: string; rulesetVersion: string; artworkSha: string; issuedAt: string; pdf: boolean }
  | { kind: "preparing"; jobId: string }
  | { kind: "failed"; jobId: string; failedAt: string }
  | { kind: "none" };

export type ReportLine = {
  checkId: string;
  productId: string;
  product: string;
  nodeId: string;
  market: string;
  language: string | null;
  rulesetVersion: string;
  checkedAt: string;
  report: ReportState;
};

export class ReportsReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read report exports (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "ReportsReadError";
  }
}

export const reportKey = (checkId: string) => `report:${checkId}`;

/** The latest check of each product × market × language, newest first (checks arrive newest first). */
export function latestChecks(checks: CheckRow[], limit = ROWS_SHOWN): CheckRow[] {
  const seen = new Set<string>();
  const out: CheckRow[] = [];
  for (const c of [...checks].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const key = `${c.product_id}|${c.node_id}|${c.language ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** A check's report state: the issued report wins over its job; a job's status otherwise; none when neither exists. */
export function reportState(checkId: string, reports: ReportRow[], jobs: ReportJobRow[]): ReportState {
  const issued = reports
    .filter((r) => r.check_ids.includes(checkId))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (issued) {
    return {
      kind: "issued",
      reportId: issued.id,
      ref: issued.ref,
      rulesetVersion: issued.ruleset_version,
      artworkSha: issued.artwork_sha,
      issuedAt: issued.created_at,
      pdf: !!issued.pdf_path,
    };
  }
  const job = jobs.find((j) => j.idempotency_key === reportKey(checkId));
  if (!job) return { kind: "none" };
  if (job.status === "queued" || job.status === "running") return { kind: "preparing", jobId: job.id };
  // failed, cancelled, or succeeded with no report this person may read: never offered as a download. A failed job
  // stays the check's job (issue 188, default 3), so the screen says so and offers no retry.
  return { kind: "failed", jobId: job.id, failedAt: job.updated_at };
}

export function reportLines(
  checks: CheckRow[],
  reports: ReportRow[],
  jobs: ReportJobRow[],
  products: Map<string, string>,
  markets: Map<string, string>,
): ReportLine[] {
  return checks
    .filter((c) => products.has(c.product_id))
    .map((c) => ({
      checkId: c.id,
      productId: c.product_id,
      product: products.get(c.product_id)!,
      nodeId: c.node_id,
      market: markets.get(c.node_id) ?? c.node_id,
      language: c.language,
      rulesetVersion: c.ruleset_version,
      checkedAt: c.at,
      report: reportState(c.id, reports, jobs),
    }));
}

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new ReportsReadError(what, r.error);
  return r.data as T;
}

export async function readReportLines(supabase: Client, workspaceId: string): Promise<ReportLine[]> {
  const app = supabase.schema("app");
  const checkRows = ok(
    "checks",
    await app
      .from("checks")
      .select("id, product_id, node_id, language, ruleset_version, at")
      .eq("workspace_id", workspaceId)
      .order("at", { ascending: false })
      .limit(CHECKS_READ),
  ) ?? [];
  const checks = latestChecks(checkRows);
  if (!checks.length) return [];
  const ids = checks.map((c) => c.id);
  const productIds = [...new Set(checks.map((c) => c.product_id))];
  const nodeIds = [...new Set(checks.map((c) => c.node_id))];
  const [reports, jobs, products, markets] = await Promise.all([
    app
      .from("reports")
      .select("id, ref, check_ids, ruleset_version, artwork_sha, pdf_path, created_at")
      .eq("workspace_id", workspaceId)
      .overlaps("check_ids", ids),
    app
      .from("jobs")
      .select("id, idempotency_key, status, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("kind", "report")
      .in("idempotency_key", ids.map(reportKey)),
    app.from("products").select("id, name").eq("workspace_id", workspaceId).in("id", productIds),
    supabase.schema("ref").from("jurisdictions").select("id, name").in("id", nodeIds),
  ]);
  return reportLines(
    checks,
    ok("reports", reports) ?? [],
    ok("report jobs", jobs) ?? [],
    new Map((ok("products", products) ?? []).map((p) => [p.id, p.name])),
    new Map((ok("markets", markets) ?? []).map((j) => [j.id, j.name])),
  );
}
