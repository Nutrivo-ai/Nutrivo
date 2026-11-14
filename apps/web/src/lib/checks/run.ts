// D08 / D04 step 1 from the browser: the design's "Run the check" bar on S-NV2-002. The only write is the existing
// app.request_check RPC (docs/04), which picks the latest artwork, the latest released ruleset and the latest
// classification itself; its job key is artwork × ruleset × classification × markets, so asking twice for the same
// revision returns the same job, and a new revision is a new job. Checks are never metered (BE-32): nothing here
// touches the allowance, and the earlier checks stay as they were (app.checks is insert-only, BE-05).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { JobRow } from "@/lib/artwork/progress";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import type { RunSummary } from "@/lib/artwork/queries";
import { asRpcError, isRateLimited, rateLimitMessage, type RpcErrorLike } from "@/lib/rate-limit";

type Db = SupabaseClient<Database>;

export type CheckRefusal = { code: string; title: string; body: string };

/** request_check's refusals (docs/03 error codes) as what the person sees. */
export function checkRefusal(input: string | RpcErrorLike | null | undefined): CheckRefusal {
  const error = asRpcError(input);
  const code = error?.code ?? undefined;
  if (isRateLimited(error)) return { code: "P0049", ...rateLimitMessage(error, "Nothing was run and nothing was counted.") };
  switch (code) {
    case "42501":
      return {
        code,
        title: "Your role cannot run a check on this product",
        body: "Running a check needs an editor or a role above it. An admin of this workspace can change your role.",
      };
    case "P0002":
      return {
        code,
        title: "This product has no artwork to check yet",
        body: "Upload the artwork first. The check reads every printed language panel from the file itself.",
      };
    case "P0003":
      return {
        code,
        title: "No ruleset has been released yet",
        body: "A check is always pinned to a released ruleset, and none exists yet. Nothing was run and nothing was counted.",
      };
    default:
      return {
        code: code ?? "unknown",
        title: "The check was not started",
        body: "Nothing was run and nothing was counted. Try again.",
      };
  }
}

export type RequestResult = { ok: true; jobId: string } | { ok: false; refusal: CheckRefusal };

export async function requestCheck(db: Db, productId: string, requestId?: string): Promise<RequestResult> {
  const call = db.schema("app").rpc("request_check", { p_product: productId });
  const { data, error } = await (requestId ? call.setHeader(REQUEST_ID_HEADER, requestId) : call);
  if (error || !data) return { ok: false, refusal: checkRefusal(error) };
  return { ok: true, jobId: data };
}

/** Whether the bar's button can run, and if not, the one thing that is missing. */
export type Readiness = { ready: true } | { ready: false; reason: string };

export function readiness(args: { run: RunSummary | null | undefined; hasArtwork: boolean; markets: number }): Readiness {
  if (!args.hasArtwork) return { ready: false, reason: "Upload the artwork first: a check reads the printed panels from the file." };
  if (!args.run || args.run.status === "queued" || args.run.status === "running") {
    return { ready: false, reason: "The artwork is still being read. The check can run when its panels are extracted." };
  }
  if (args.run.status === "failed") {
    return { ready: false, reason: "This artwork could not be read, so there is nothing to check. Upload a new version." };
  }
  if (args.markets === 0) return { ready: false, reason: "Choose at least one market above: a check answers per market." };
  return { ready: true };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The bar's heading, as the design words it: "1 product × 9 jurisdiction nodes × 11 languages, answered in one pass". */
export function passLine(markets: number, languages: number): string {
  return `1 product × ${plural(markets, "jurisdiction node")} × ${plural(languages, "language")}, answered in one pass`;
}

export type CheckJobView =
  | { phase: "waiting" }
  | { phase: "queued"; retrying: boolean }
  | { phase: "running" }
  | { phase: "done"; checks: number; clear: number; action: number; notAssessed: number; again: boolean }
  | { phase: "failed"; reason: string };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A check job (app.jobs) as the bar shows it. Progress holds counts only (worker handlers/check.py). */
export function describeCheckJob(row: JobRow | null): CheckJobView {
  if (!row) return { phase: "waiting" };
  const p = row.progress ?? {};
  if (row.status === "succeeded") {
    return {
      phase: "done",
      checks: num(p.checks),
      clear: num(p.clear),
      action: num(p.action),
      notAssessed: num(p.not_assessed),
      again: p.outcome === "already_checked",
    };
  }
  if (row.status === "failed" || row.status === "cancelled") return { phase: "failed", reason: failedReason(row.last_error) };
  if (row.status === "running") return { phase: "running" };
  return { phase: "queued", retrying: row.attempts > 0 };
}

/** last_error holds codes and ids only; the person sees what it means, never the raw text. */
export function failedReason(lastError: string | null): string {
  if (lastError?.includes("P0003")) {
    return "The ruleset this check was pinned to is not released, so nothing was assessed. Run the check again.";
  }
  return "The check stopped after its retries, and wrote nothing. Earlier checks are unchanged. Run the check again.";
}
