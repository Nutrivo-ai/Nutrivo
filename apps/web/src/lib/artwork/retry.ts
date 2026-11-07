// T-305: S-NV2-002's failed extraction offers a retry. The only write is app.retry_extraction (docs/04), which queues
// the artwork version's failed extract job again under the same id, or returns it unchanged when it has not failed,
// so a second click queues nothing. A retry is never a new artwork: nothing is counted (BE-32).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";

type Db = SupabaseClient<Database>;

export type RetryRefusal = { code: string; title: string; body: string };

/** retry_extraction's refusals (docs/03 error codes) as what the person sees. */
export function retryRefusal(code: string | undefined): RetryRefusal {
  switch (code) {
    case "42501":
      return {
        code,
        title: "Your role cannot retry this extraction",
        body: "Retrying needs an editor or a role above it on this product. An admin of this workspace can change your role.",
      };
    case "P0002":
      return {
        code,
        title: "There is no extraction to retry",
        body: "This artwork was never queued for reading. Upload the file again as a new version to read it.",
      };
    default:
      return {
        code: code ?? "unknown",
        title: "The extraction was not retried",
        body: "Nothing changed and nothing was counted. Try again in a moment.",
      };
  }
}

export type RetryResult = { ok: true; jobId: string } | { ok: false; refusal: RetryRefusal };

export async function retryExtraction(db: Db, artworkVersionId: string, requestId?: string): Promise<RetryResult> {
  const call = db.schema("app").rpc("retry_extraction", { p_artwork: artworkVersionId });
  const { data, error } = await (requestId ? call.setHeader(REQUEST_ID_HEADER, requestId) : call);
  if (error || !data) return { ok: false, refusal: retryRefusal(error?.code) };
  return { ok: true, jobId: data };
}
