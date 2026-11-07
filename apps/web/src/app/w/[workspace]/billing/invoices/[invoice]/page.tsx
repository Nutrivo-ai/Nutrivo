import { InvoiceView } from "@/components/billing/InvoiceView";
import { billingGate } from "@/lib/billing/page";
import { readInvoiceById, readUsage } from "@/lib/billing/read";
import { createClient } from "@/lib/supabase/server";

// S-PLN-003 Invoice and receipt (spec/screens.yaml; design: product/Nutrivo Plans and Checkout.dc.html, screen
// "invoice"). M03 (T-703). `[invoice]` is a Stripe invoice id, found only among the caller's own workspace's stored
// invoice events (app.billing_context, then RLS). Never cached.
export default async function Page({ params }: PageProps<"/w/[workspace]/billing/invoices/[invoice]">) {
  const { workspace, invoice } = await params;
  const supabase = await createClient();
  const gate = await billingGate(supabase, workspace);
  if (!gate.ok) return <InvoiceView route="/w/[workspace]/billing/invoices/[invoice]" view={{ kind: "no-permission", workspace: gate.workspace }} />;
  const [found, usage] = await Promise.all([readInvoiceById(supabase, workspace, decodeURIComponent(invoice)), readUsage(supabase, workspace)]);
  return (
    <InvoiceView
      route="/w/[workspace]/billing/invoices/[invoice]"
      view={
        found
          ? { kind: "invoice", workspaceId: workspace, workspace: gate.ctx.name, invoice: found, inUse: { recipes: usage.counts.recipes, editorSeats: usage.counts.editorSeats } }
          : { kind: "unknown", workspaceId: workspace }
      }
    />
  );
}
