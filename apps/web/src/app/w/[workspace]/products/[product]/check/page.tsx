import { ArtworkUpload } from "@/components/artwork/ArtworkUpload";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { Screen } from "@/components/shell";
import { readLatestArtwork, readProduct } from "@/lib/artwork/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-002 Upload & scope (spec/screens.yaml), T-303: "1 · What you have", the artwork card with its signed upload,
// app.register_artwork and extraction progress (D01, C02). Markets, classification and running the check are added
// by their own tasks (T-401, T-402, T-403); until then they are not drawn, so no control here does nothing.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/check">) {
  const { workspace, product: productId } = await params;
  const db = await createClient();
  const product = await readProduct(db, workspace, productId);
  const latest = product ? await readLatestArtwork(db, product.id) : null;
  return (
    <Screen route="/w/[workspace]/products/[product]/check" crumb="Check your label · Step 1 of 2" title={product?.name}>
      {product ? (
        <div className="grid gap-[20px] items-start md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="what-you-have">
            <h2 id="what-you-have" className="m-0 mb-[10px] font-mono text-[10px] font-normal tracking-[0.13em] uppercase text-n600">
              1 · What you have
            </h2>
            <ArtworkUpload workspaceId={workspace} productId={product.id} latest={latest} />
            <p className="mt-[12px] mb-0 text-[12.5px] leading-[1.5] text-n700">
              Run with what you have. Anything missing narrows the check — it never blocks it, and the report says
              exactly which rules went unassessed and why.
            </p>
          </section>
        </div>
      ) : (
        <ProductNotFound workspaceId={workspace} />
      )}
    </Screen>
  );
}
