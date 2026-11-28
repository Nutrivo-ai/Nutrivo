"use server";

// I01 (T-1112): request the Report of Check for one check, from S-NV2-018. The write goes through app.request_report
// (T-408) under the person's own session: an editor-class member who sees the check's product and market; viewers and
// anyone else get 42501. One job per check (key `report:<check_id>`), so a repeat request returns the same job and the
// check keeps one reference (BE-26). The job's payload is the check id and the request id, never a token.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { isRateLimited, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type ReportRequestResult =
  | { ok: true; value: string }
  | { ok: false; reason: "no-permission" | "rate-limited" | "error"; problem?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestReport(checkId: string): Promise<ReportRequestResult> {
  if (!UUID.test(checkId)) return { ok: false, reason: "error" };
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "report.request");
    return Sentry.startSpan({ name: "report.request", op: "function.server_action" }, async () => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .schema("app")
        .rpc("request_report", { p_check: checkId, p_request_id: requestId });
      if (error) {
        if (error.code === "42501") return { ok: false, reason: "no-permission" } as const;
        if (isRateLimited(error)) {
          return {
            ok: false,
            reason: "rate-limited",
            problem: rateLimitMessage(error, "The report was not requested.").body,
          } as const;
        }
        Sentry.captureException(new Error(`request_report failed: ${error.code ?? "error"}`));
        return { ok: false, reason: "error" } as const;
      }
      return { ok: true, value: String(data) } as const;
    });
  });
}
