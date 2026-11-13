import * as Sentry from "@sentry/nextjs";
import { PaymentMethod } from "@/components/billing/PaymentMethod";
import { billingChip } from "@/lib/billing/chip";
import { billingGate } from "@/lib/billing/page";
import { readCards, readUsage } from "@/lib/billing/read";
import { workspaceCustomer } from "@/lib/billing/context";
import { StripeConfigError } from "@/lib/billing/stripe";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment method · Nutrivo" };

// S-BIL-003 Payment method (spec/screens.yaml; design: product/Nutrivo Billing Settings.dc.html, screen "payment").
// M04, M05 (T-703). The card is read from Stripe now (decided on #64); when Stripe does not answer the screen says
// so rather than showing no card.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings/billing/payment">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const gate = await billingGate(supabase, workspace);
  if (!gate.ok) return <PaymentMethod route="/w/[workspace]/settings/billing/payment" view={{ kind: "no-permission", workspace: gate.workspace }} />;
  const usage = await readUsage(supabase, workspace);
  let hasCustomer = false;
  let cards: Awaited<ReturnType<typeof readCards>> | null = null;
  try {
    hasCustomer = !!(await workspaceCustomer(gate.ctx, { create: false }));
    cards = hasCustomer ? await readCards(gate.ctx) : [];
  } catch (e) {
    if (!(e instanceof StripeConfigError)) Sentry.captureException(e, { tags: { area: "billing", screen: "S-BIL-003" } });
    cards = null;
  }
  return <PaymentMethod route="/w/[workspace]/settings/billing/payment" view={{ kind: "loaded", workspaceId: workspace, chip: billingChip(usage.subscription, usage.counts), hasCustomer, cards }} />;
}
