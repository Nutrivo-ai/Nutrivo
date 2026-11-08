import * as Sentry from "@sentry/nextjs";
import { SendReport } from "@/components/report/SendReport";
import { readSendPage } from "@/lib/share/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-026 Export, send, share (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "send"), I01 and I02.
// The product's issued reports and the chosen one's shares, read under RLS. A read failure goes to the workspace error
// boundary, and loading.tsx covers the wait.
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspace]/products/[product]/report/send">) {
  const { workspace, product } = await params;
  const report = (await searchParams).report;
  const supabase = await createClient();
  const page = await Sentry.startSpan({ name: "report.send.read", op: "db.read" }, () =>
    readSendPage(supabase, workspace, product, typeof report === "string" ? report : null),
  );
  return (
    <SendReport route="/w/[workspace]/products/[product]/report/send" workspaceId={workspace} productId={product} page={page} />
  );
}
