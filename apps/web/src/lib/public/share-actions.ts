"use server";

// I02 (T-604): Download PDF on /share/<token>. The recipient has no session; the `share` Edge Function checks the token
// again (a link revoked since the page loaded answers unknown), logs the access and signs the stored PDF for 300 s. The
// token is never logged or tagged; Sentry's scrubber also redacts it from /share/<token> paths.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { sharedPdfLink, type PdfOutcome } from "./share";
import { visitorOf } from "./verify";

export async function downloadSharedPdf(token: string): Promise<PdfOutcome> {
  if (typeof token !== "string") return { kind: "unknown" };
  const h = await headers();
  const requestId = resolveRequestId(h.get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "share.download");
    return Sentry.startSpan({ name: "share.download", op: "function.server_action" }, () =>
      sharedPdfLink(token, { requestId, visitor: visitorOf(h), userAgent: h.get("user-agent") }),
    );
  });
}
