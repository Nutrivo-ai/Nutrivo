import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { FixError } from "@/components/report/FixStates";
import { FixMode } from "@/components/report/FixMode";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { readFix, type FixPage } from "@/lib/report/fix-queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Label report · Nutrivo" };

// S-FIX-001 to S-FIX-013 · the label report as Fix mode (spec/screens.yaml; design: product/Nutrivo Fix Mode*.dc.html),
// D-33, T-1114; D07 and D08. Each market's latest check, one result set per market × printed language panel, read under
// RLS; ?job=<id> opens an older check job of the product read-only (S-FIX-004). loading.tsx covers the wait (S-FIX-010);
// a read that fails shows S-FIX-011 with this response's own request id, never a made-up one.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/products/[product]/report">) {
  const [{ workspace, product }, query, h] = await Promise.all([params, searchParams, headers()]);
  const job = typeof query.job === "string" ? query.job : null;
  const requestId = resolveRequestId(h.get(REQUEST_ID_HEADER));
  const supabase = await createClient();
  let page: FixPage;
  try {
    page = await Sentry.startSpan({ name: "report.read", op: "db.read", attributes: { request_id: requestId } }, () =>
      readFix(supabase, workspace, product, job),
    );
  } catch (error) {
    Sentry.captureException(error, { tags: { screen: "S-FIX-011", request_id: requestId } });
    return <FixError requestId={requestId} />;
  }
  if (page.kind === "loaded" && page.model.ungapped > 0) {
    // #46 question 4: a withheld finding without a coverage gap cannot link to one. Seen, never silent.
    Sentry.captureMessage("label report: withheld findings without a coverage gap", {
      level: "warning",
      tags: { screen: "S-FIX-001", request_id: requestId },
      extra: { product, ungapped: page.model.ungapped },
    });
  }
  return <FixMode workspaceId={workspace} productId={product} page={page} />;
}
