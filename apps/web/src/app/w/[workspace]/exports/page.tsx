import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import { Exports } from "@/components/exports/Exports";
import { Screen } from "@/components/shell";
import { exportState, readLatestExport } from "@/lib/exports/exports";
import { readReportLines } from "@/lib/exports/reports";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";

export const metadata: Metadata = { title: "Exports · Nutrivo" };

// S-NV2-018 Exports (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "exports"). I01 and O03 (T-1112):
// the Report of Check of the latest check of each product, market and language, and the full export. Every read is
// under the person's own session (RLS); the writes are app.request_report and app.request_export, and a download is a
// link Storage signs under the same session, so it never reaches another workspace's object. The full export is read
// only for an admin, whose card it is. A failed read goes to the workspace error boundary; loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/exports">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const context = await loadShellContext(supabase, workspace);
  if (context.kind !== "member") return null; // the workspace layout has already shown NoAccess
  const admin = context.current.role === "admin";
  const data = await Sentry.startSpan({ name: "exports.read", op: "db.read" }, async () => {
    const [lines, latest] = await Promise.all([
      readReportLines(supabase, workspace),
      admin ? readLatestExport(supabase, workspace) : Promise.resolve(null),
    ]);
    return { lines, fullExport: admin ? exportState(latest, workspace) : null };
  });
  return (
    <Screen route="/w/[workspace]/exports" title="Reports of Check and the full export">
      <Exports view={{ workspaceId: workspace, ...data }} />
    </Screen>
  );
}
