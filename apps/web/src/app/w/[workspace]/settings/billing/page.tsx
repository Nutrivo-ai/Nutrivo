import { PlanAllowance } from "@/components/billing/PlanAllowance";
import { billingContext, readUsage } from "@/lib/billing/read";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Plan and allowance · Nutrivo" };

// S-BIL-001 Plan and allowance (spec/screens.yaml; design: product/Nutrivo Billing Settings.dc.html, screen "plan").
// M02, M05, B02 (T-703). Never cached: the dials are read from app.live_billable_counts on every request (M02.must.1).
// Only an internal admin of the whole workspace manages billing (app.billing_context); a failed read goes to the
// workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/settings/billing">) {
  const { workspace } = await params;
  const from = (await searchParams).from;
  const supabase = await createClient();
  const c = await billingContext(supabase, workspace);
  if (!c.ok) {
    if (c.reason === "no-permission") {
      const { data } = await supabase.schema("app").from("workspaces").select("name").eq("id", workspace).maybeSingle();
      return <PlanAllowance route="/w/[workspace]/settings/billing" view={{ kind: "no-permission", workspace: data?.name ?? "this workspace" }} />;
    }
    throw new Error(`billing context failed: ${c.code ?? "error"}`);
  }
  const usage = await readUsage(supabase, workspace);
  return (
    <PlanAllowance route="/w/[workspace]/settings/billing"
      view={{
        kind: "loaded",
        workspaceId: workspace,
        plan: usage.plan,
        status: usage.status,
        counts: usage.counts,
        subscription: usage.subscription,
        returning: from === "checkout",
      }}
    />
  );
}
