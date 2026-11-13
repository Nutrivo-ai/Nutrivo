import * as Sentry from "@sentry/nextjs";
import { BillingDetails } from "@/components/billing/BillingDetails";
import { billingChip } from "@/lib/billing/chip";
import { billingGate } from "@/lib/billing/page";
import { readDetails, readUsage } from "@/lib/billing/read";
import { StripeConfigError } from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Billing details · Nutrivo" };

// S-BIL-004 Billing details (spec/screens.yaml; design: product/Nutrivo Billing Settings.dc.html, screen "details").
// M03 (T-703). The details are the Stripe customer's, read now (decided on #64). When Stripe does not answer the form
// is not offered, so nothing is saved over details the screen could not read.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings/billing/details">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const gate = await billingGate(supabase, workspace);
  if (!gate.ok) return <BillingDetails route="/w/[workspace]/settings/billing/details" view={{ kind: "no-permission", workspace: gate.workspace }} />;
  const usage = await readUsage(supabase, workspace);
  const chip = billingChip(usage.subscription, usage.counts);
  const details = await readDetails(gate.ctx).catch((e) => {
    if (!(e instanceof StripeConfigError)) Sentry.captureException(e, { tags: { area: "billing", screen: "S-BIL-004" } });
    return null;
  });
  return (
    <BillingDetails route="/w/[workspace]/settings/billing/details"
      view={details ? { kind: "loaded", workspaceId: workspace, chip, details } : { kind: "unavailable", workspaceId: workspace, chip }}
    />
  );
}
