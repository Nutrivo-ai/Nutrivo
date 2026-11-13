import { ArtworkReport, reportTitle } from "@/components/artwork/ArtworkReport";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { LoadingState } from "@/components/kit";
import { Screen } from "@/components/shell";
import { readArtwork, readPanelChecks, readPanels, readProduct } from "@/lib/artwork/queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Artwork · Nutrivo" };

// S-NV2-025 Artwork we cannot read (spec/screens.yaml), T-303: what the extraction read, per printed panel (D01, D02),
// for any outcome: complete, partial with named failures, or nothing readable. T-304 (D02): each panel's state over
// its markets' latest checks, and a panel that cannot be assessed reads Not assessed with its reason code.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/artwork/[artwork]">) {
  const { workspace, product: productId, artwork: artworkId } = await params;
  const db = await createClient();
  const product = await readProduct(db, workspace, productId);
  const art = product ? await readArtwork(db, product.id, artworkId) : null;
  const panels = art?.run ? await readPanels(db, art.run.id) : [];
  const checks = await readPanelChecks(db, workspace, panels.map((p) => p.id));
  const checkHref = `/w/${workspace}/products/${productId}/check`;
  return (
    <Screen
      route="/w/[workspace]/products/[product]/artwork/[artwork]"
      crumb="Check your label · Artwork"
      title={art?.run ? reportTitle(art.run) : art ? "Extraction in progress" : undefined}
    >
      {!product || !art ? (
        <ProductNotFound workspaceId={workspace} what={product ? "artwork" : "product"} />
      ) : art.run ? (
        <ArtworkReport
          art={art}
          run={art.run}
          panels={panels}
          checks={checks}
          checkHref={checkHref}
          reportHref={`/w/${workspace}/products/${productId}/report`}
        />
      ) : (
        <div className="max-w-[640px]">
          <LoadingState label={`Extraction in progress · ${art.fileName ?? `version ${art.version}`}`}>
            Panels, languages and text appear here when it finishes. <a href={checkHref} className="underline">Follow its progress</a>.
          </LoadingState>
        </div>
      )}
    </Screen>
  );
}
