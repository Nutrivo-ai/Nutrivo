import * as Sentry from "@sentry/nextjs";
import { Markets } from "@/components/mobile/Markets";
import { MarketsShapeError } from "@/lib/products/markets";
import { readMarkets } from "@/lib/products/markets-queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Product · Nutrivo" };

// S-MOB-002 One recipe, its markets (spec/screens.yaml; design: product/Nutrivo Mobile.dc.html, "Read a verdict"). The
// product the board links to, read under RLS: its markets with their states, each region's roll-up from
// app.rollup_state (BE-15), and its latest check. A read failure goes to the workspace error boundary, and the
// workspace loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]">) {
  const { workspace, product } = await params;
  const supabase = await createClient();
  const page = await Sentry.startSpan({ name: "product_markets.read", op: "db.read" }, () => readMarkets(supabase, workspace, product)).catch(
    (error: unknown) => {
      // A roll-up better than a market it covers: a BE-15 regression, or a check that landed between the two reads.
      // Tagged so the two can be told apart; the workspace error boundary still shows the page as failed.
      if (error instanceof MarketsShapeError) Sentry.captureException(error, { tags: { screen: "S-MOB-002", guard: "rollup_order" }, extra: { product } });
      throw error;
    },
  );
  return <Markets route="/w/[workspace]/products/[product]" workspaceId={workspace} page={page} />;
}
