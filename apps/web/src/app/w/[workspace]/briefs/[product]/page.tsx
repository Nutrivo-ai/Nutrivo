import * as Sentry from "@sentry/nextjs";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { BriefForm } from "@/components/briefs/BriefForm";
import { ErrorState } from "@/components/kit";
import { Screen } from "@/components/shell";
import { readBrief, type Brief } from "@/lib/briefs/queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Brief & formula · Nutrivo" };

// S-NV2-004 Brief & formula (spec/screens.yaml), T-1001 · E01 Create a brief: the product at stage brief (C01), its
// formula lines and its intended claims per language. Editors and above (the Screen applies the route's role; the
// RPCs decide). States: loading (loading.tsx), empty (no formula yet, in BriefForm), error, no-permission, not found.
export default async function Page({ params }: PageProps<"/w/[workspace]/briefs/[product]">) {
  const { workspace, product: productId } = await params;
  const db = await createClient();
  let brief: Brief | null = null;
  let failed = false;
  try {
    brief = await readBrief(db, workspace, productId);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "briefs" } });
    failed = true;
  }
  return (
    <Screen
      route="/w/[workspace]/briefs/[product]"
      crumb="New product · Brief · Step 1 of 2"
      title={brief ? `${brief.name} — working brief` : undefined}
    >
      {failed ? (
        <div className="max-w-[640px]">
          <ErrorState
            where="BRIEF & FORMULA"
            title="The brief could not be read"
            body="Nothing was changed: the formula and claims already saved are kept. Reload the page to read them again."
            action={{ label: "Reload", href: `/w/${workspace}/briefs/${productId}`, variant: "primary" }}
          />
        </div>
      ) : brief ? (
        <BriefForm key={brief.id} workspaceId={workspace} brief={brief} />
      ) : (
        <ProductNotFound workspaceId={workspace} />
      )}
    </Screen>
  );
}
