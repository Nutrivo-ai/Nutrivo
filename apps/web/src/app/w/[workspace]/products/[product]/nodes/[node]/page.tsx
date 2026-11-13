import * as Sentry from "@sentry/nextjs";
import { Verdict } from "@/components/mobile/Verdict";
import { readVerdict } from "@/lib/verdict/queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Product × market · Nutrivo" };

// S-MOB-003 The verdict (spec/screens.yaml; design: product/Nutrivo Mobile.dc.html, "Read a verdict"). One product in
// one market, read under RLS. The desktop Product × node layout (S-NV2-007) is T-504's. A read failure goes to the
// workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/nodes/[node]">) {
  const { workspace, product, node } = await params;
  const supabase = await createClient();
  const page = await Sentry.startSpan({ name: "verdict.read", op: "db.read" }, () =>
    readVerdict(supabase, workspace, product, decodeURIComponent(node)),
  );
  if (page.kind === "loaded" && page.verdict.source.kind === "ungapped") {
    // #46 question 4: a withheld result without a coverage gap cannot link to one. Seen, never silent.
    Sentry.captureMessage("verdict: withheld findings without a coverage gap", {
      level: "warning",
      tags: { screen: "S-MOB-003" },
      extra: { product, node },
    });
  }
  return <Verdict route="/w/[workspace]/products/[product]/nodes/[node]" workspaceId={workspace} page={page} />;
}
