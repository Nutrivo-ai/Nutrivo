import * as Sentry from "@sentry/nextjs";
import { Checkout } from "@/components/billing/Checkout";
import { isLive, isPaidPlan, isTerm } from "@/lib/billing/plans";
import { billingContext, previewFirstInvoice, readDetails, readUsage } from "@/lib/billing/read";
import { StripeConfigError } from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";

// S-PLN-002 Checkout (spec/screens.yaml; design: product/Nutrivo Plans and Checkout.dc.html, screen "checkout").
// M01, M03 (T-703). The review step before Stripe-hosted Checkout (decided on #64): the plan and term come from the
// picker's link, the workspace and its Stripe customer from app.billing_context. A workspace with a live subscription
// changes plan in the portal instead. Never cached (no "use cache" under cacheComponents): the counts and the customer are read on each request.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/billing/checkout">) {
  const { workspace } = await params;
  const q = await searchParams;
  const supabase = await createClient();
  const c = await billingContext(supabase, workspace);
  if (!c.ok) {
    if (c.reason === "no-permission") {
      const { data } = await supabase.schema("app").from("workspaces").select("name").eq("id", workspace).maybeSingle();
      return <Checkout route="/w/[workspace]/billing/checkout" view={{ kind: "no-permission", workspace: data?.name ?? "this workspace" }} />;
    }
    throw new Error(`billing context failed: ${c.code ?? "error"}`);
  }
  const ctx = c.ctx;
  if (isLive(ctx.subscriptionStatus)) return <Checkout route="/w/[workspace]/billing/checkout" view={{ kind: "live", workspaceId: workspace, plan: ctx.plan }} />;
  const plan = typeof q.plan === "string" ? q.plan : "";
  const term = typeof q.term === "string" && isTerm(q.term) ? q.term : "monthly";
  if (!isPaidPlan(plan) || plan === "advanced") return <Checkout route="/w/[workspace]/billing/checkout" view={{ kind: "pick-a-plan", workspaceId: workspace }} />;
  const usage = await readUsage(supabase, workspace);
  // The customer's details and the VAT preview are a courtesy: without Stripe the page still shows the net order.
  const details = await readDetails(ctx).catch((e) => {
    if (!(e instanceof StripeConfigError)) Sentry.captureException(e, { tags: { area: "billing", screen: "S-PLN-002" } });
    return null;
  });
  const preview = details?.customerId ? await previewFirstInvoice(ctx, plan, term) : null;
  return (
    <Checkout
      route="/w/[workspace]/billing/checkout"
      view={{
        kind: "loaded",
        workspaceId: workspace,
        plan,
        term,
        counts: { recipes: usage.counts.recipes, regions: Math.max(1, usage.counts.regions.length), editorSeats: usage.counts.editorSeats },
        details,
        preview,
        today: new Date().toISOString(),
      }}
    />
  );
}
