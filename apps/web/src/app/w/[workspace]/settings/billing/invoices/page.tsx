import * as Sentry from "@sentry/nextjs";
import { Invoices } from "@/components/billing/Invoices";
import { billingChip } from "@/lib/billing/chip";
import { billingGate } from "@/lib/billing/page";
import { readDetails, readInvoices, readUsage } from "@/lib/billing/read";
import { StripeConfigError } from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";

// S-BIL-002 Invoices (spec/screens.yaml; design: product/Nutrivo Billing Settings.dc.html, screen "invoices"). M03
// (T-703). The invoices from the stored Stripe events (admins only, RLS); the finance address from the Stripe
// customer, which the list does without when Stripe does not answer.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings/billing/invoices">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const gate = await billingGate(supabase, workspace);
  if (!gate.ok) return <Invoices route="/w/[workspace]/settings/billing/invoices" view={{ kind: "no-permission", workspace: gate.workspace }} />;
  const [usage, invoices, details] = await Promise.all([
    readUsage(supabase, workspace),
    readInvoices(supabase, workspace),
    readDetails(gate.ctx).catch((e) => {
      if (!(e instanceof StripeConfigError)) Sentry.captureException(e, { tags: { area: "billing", screen: "S-BIL-002" } });
      return null;
    }),
  ]);
  return (
    <Invoices route="/w/[workspace]/settings/billing/invoices"
      view={{ kind: "loaded", workspaceId: workspace, invoices, financeEmail: details ? details.financeEmail : null, chip: billingChip(usage.subscription, usage.counts) }}
    />
  );
}
