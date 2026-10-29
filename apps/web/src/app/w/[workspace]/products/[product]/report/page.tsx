import * as Sentry from "@sentry/nextjs";
import { LabelReport } from "@/components/report/LabelReport";
import { readReport } from "@/lib/report/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-003 Label report (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "report"). D07: the product's
// latest check, one result set per market × printed language panel, read under RLS. A read failure goes to the
// workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/report">) {
  const { workspace, product } = await params;
  const supabase = await createClient();
  const page = await Sentry.startSpan({ name: "report.read", op: "db.read" }, () => readReport(supabase, workspace, product));
  if (page.kind === "loaded" && page.report.ungapped > 0) {
    // #46 question 4: a withheld finding without a coverage gap cannot link to one. Seen, never silent.
    Sentry.captureMessage("label report: withheld findings without a coverage gap", {
      level: "warning",
      tags: { screen: "S-NV2-003" },
      extra: { product, ungapped: page.report.ungapped },
    });
  }
  return <LabelReport route="/w/[workspace]/products/[product]/report" workspaceId={workspace} productId={product} page={page} />;
}
