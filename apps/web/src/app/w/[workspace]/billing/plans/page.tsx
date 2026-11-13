import { Plans } from "@/components/billing/Plans";
import { billingContext, readUsage } from "@/lib/billing/read";
import { isTerm } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Plans · Nutrivo" };

// S-PLN-001 Plan picker (spec/screens.yaml; design: product/Nutrivo Plans and Checkout.dc.html, screen "plans").
// M01, M02 (T-703). The counts are read on every request, never cached (M02.must.1): nothing here is "use cache", so under
// cacheComponents app.live_billable_counts runs each time the page renders. Only an internal admin of the whole workspace manages billing
// (app.billing_context); anyone else gets the no-permission state. A failed read goes to the workspace error boundary.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/billing/plans">) {
  const { workspace } = await params;
  const term = (await searchParams).term;
  const supabase = await createClient();
  const ctx = await billingContext(supabase, workspace);
  if (!ctx.ok) {
    if (ctx.reason === "no-permission") {
      const { data } = await supabase.schema("app").from("workspaces").select("name").eq("id", workspace).maybeSingle();
      return <Plans route="/w/[workspace]/billing/plans" view={{ kind: "no-permission", workspace: data?.name ?? "this workspace" }} />;
    }
    throw new Error(`billing context failed: ${ctx.code ?? "error"}`);
  }
  const usage = await readUsage(supabase, workspace);
  return (
    <Plans
      route="/w/[workspace]/billing/plans"
      view={{
        kind: "loaded",
        workspaceId: workspace,
        counts: usage.counts,
        checksRun: usage.checksRun,
        plan: usage.plan,
        subscriptionStatus: ctx.ctx.subscriptionStatus,
        term: typeof term === "string" && isTerm(term) ? term : ctx.ctx.term === "annual" ? "annual" : "monthly",
      }}
    />
  );
}
