import { InvoiceView } from "@/components/billing/InvoiceView";
import { isLive } from "@/lib/billing/plans";
import { billingContext, readInvoiceOrReturn, readUsage } from "@/lib/billing/read";
import { createClient } from "@/lib/supabase/server";

// S-PLN-003 Invoice and receipt (spec/screens.yaml; design: product/Nutrivo Plans and Checkout.dc.html, screen
// "invoice"). M03 (T-703). `[invoice]` is a Stripe invoice id, or the Checkout Session id Stripe returns with after
// payment; either is resolved only within the caller's own workspace (app.billing_context). Never cached: the invoice
// event may arrive while the page waits for it.
export default async function Page({ params }: PageProps<"/w/[workspace]/billing/invoices/[invoice]">) {
  const { workspace, invoice } = await params;
  const supabase = await createClient();
  const c = await billingContext(supabase, workspace);
  if (!c.ok) {
    if (c.reason === "no-permission") {
      const { data } = await supabase.schema("app").from("workspaces").select("name").eq("id", workspace).maybeSingle();
      return <InvoiceView route="/w/[workspace]/billing/invoices/[invoice]" view={{ kind: "no-permission", workspace: data?.name ?? "this workspace" }} />;
    }
    throw new Error(`billing context failed: ${c.code ?? "error"}`);
  }
  const found = await readInvoiceOrReturn(supabase, c.ctx, decodeURIComponent(invoice));
  if (found.kind === "unknown") return <InvoiceView route="/w/[workspace]/billing/invoices/[invoice]" view={{ kind: "unknown", workspaceId: workspace }} />;
  if (found.kind === "pending") return <InvoiceView route="/w/[workspace]/billing/invoices/[invoice]" view={{ kind: "pending", workspaceId: workspace }} />;
  const usage = await readUsage(supabase, workspace);
  const fromCheckout = invoice.startsWith("cs_");
  return (
    <InvoiceView
      route="/w/[workspace]/billing/invoices/[invoice]"
      view={{
        kind: "invoice",
        workspaceId: workspace,
        workspace: c.ctx.name,
        invoice: found.invoice,
        justSubscribed: fromCheckout && isLive(c.ctx.subscriptionStatus) && c.ctx.plan === found.invoice.plan,
        inUse: { recipes: usage.counts.recipes, editorSeats: usage.counts.editorSeats },
      }}
    />
  );
}
