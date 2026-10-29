import { ArtworkReport, reportTitle } from "@/components/artwork/ArtworkReport";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { LoadingState } from "@/components/kit";
import { Screen } from "@/components/shell";
import { readArtwork, readPanels, readProduct } from "@/lib/artwork/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-025 Artwork we cannot read (spec/screens.yaml), T-303: what the extraction read, per printed panel (D01, D02),
// for any outcome: complete, partial with named failures, or nothing readable.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/artwork/[artwork]">) {
  const { workspace, product: productId, artwork: artworkId } = await params;
  const db = await createClient();
  const product = await readProduct(db, workspace, productId);
  const art = product ? await readArtwork(db, product.id, artworkId) : null;
  const panels = art?.run ? await readPanels(db, art.run.id) : [];
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
        <ArtworkReport art={art} run={art.run} panels={panels} checkHref={checkHref} />
      ) : (
        <div className="max-w-[640px]">
          <LoadingState label={`Extraction in progress · ${art.fileName ?? `version ${art.version}`}`}>
            Panels, languages and text appear here when it finishes. <a href={checkHref}>Follow its progress</a>.
          </LoadingState>
        </div>
      )}
    </Screen>
  );
}
