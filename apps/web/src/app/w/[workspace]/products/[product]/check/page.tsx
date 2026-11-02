import { ArtworkUpload } from "@/components/artwork/ArtworkUpload";
import { ClassificationPanel, type ClassificationState } from "@/components/classification/ClassificationPanel";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import * as Sentry from "@sentry/nextjs";
import { AllowanceCounter, FourthLabel, LastLabelPanel } from "@/components/products/Allowance";
import { ProductSetup } from "@/components/products/ProductSetup";
import { Screen } from "@/components/shell";
import { readLatestArtwork, type ArtworkSummary } from "@/lib/artwork/queries";
import { readClassification } from "@/lib/classification/queries";
import { readAddProductData, readAllowance, readProductDetail } from "@/lib/products/queries";
import { allowanceMoment } from "@/lib/products/rules";
import { createClient } from "@/lib/supabase/server";

// S-NV2-002 Upload & scope (spec/screens.yaml). T-303: "1 · What you have", the artwork card with its signed upload,
// app.register_artwork and extraction progress (D01, C02). T-401: "2 · Where it is sold, and its stage" (C01 step 3,
// C04), and the free allowance's moments (B02): the header counter from the second label, one panel when one is left
// (S-PLN-004), and the fourth-label card when all are used and this product has no artwork yet (S-PLN-005); a product
// already checked keeps its free re-checks and revisions. T-402: "3 · Which rulebook applies", the classification (D03).
// Running the check is T-403's.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/check">) {
  const { workspace, product: productId } = await params;
  const db = await createClient();
  const product = await readProductDetail(db, workspace, productId);
  const [latest, allowance, setup] = product
    ? await Promise.all([readLatestArtwork(db, product.id), readAllowance(db, workspace), readAddProductData(db, workspace)])
    : [null, null, null];
  const classification = product ? await classificationState(db, product.id, latest) : null;
  const moment = allowanceMoment(allowance, Boolean(latest));
  const spent = moment.kind === "spent" && !moment.hasArtwork;
  return (
    <Screen
      route="/w/[workspace]/products/[product]/check"
      crumb="Check your label · Step 1 of 2"
      title={product?.name}
      aside={product ? <AllowanceCounter moment={moment} /> : undefined}
    >
      {product && setup ? (
        <div className="flex flex-col gap-[22px] md:max-w-[948px]">
          {moment.kind === "last" && !latest ? <LastLabelPanel workspaceId={workspace} /> : null}
          {spent ? <FourthLabel workspaceId={workspace} allowed={moment.allowed} /> : null}
          <div className="grid gap-[20px] items-start md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
            <section aria-labelledby="what-you-have">
              <h2 id="what-you-have" className="m-0 mb-[10px] font-mono text-[10px] font-normal tracking-[0.13em] uppercase text-n600">
                1 · What you have
              </h2>
              {spent ? (
                <p className="m-0 text-[13px] leading-[1.55] text-n700 border border-rule py-[14px] px-[16px]" data-artwork-needs-plan>
                  A first artwork for this product is a fourth label, so it needs a plan. Everything already checked in this
                  workspace stays readable, and re-checking it stays free.
                </p>
              ) : (
                <ArtworkUpload workspaceId={workspace} productId={product.id} latest={latest} />
              )}
              <p className="mt-[12px] mb-0 text-[12.5px] leading-[1.5] text-n700">
                Run with what you have. Anything missing narrows the check — it never blocks it, and the report says
                exactly which rules went unassessed and why.
              </p>
            </section>
            <ProductSetup
              workspaceId={workspace}
              productId={product.id}
              stage={product.stage}
              nodes={product.nodes}
              available={setup.nodes}
              regions={setup.regions}
              canEdit
            />
            {classification ? (
              <div className="md:col-start-3">
                <ClassificationPanel state={classification} productId={product.id} />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <ProductNotFound workspaceId={workspace} />
      )}
    </Screen>
  );
}

async function classificationState(
  db: Awaited<ReturnType<typeof createClient>>,
  productId: string,
  latest: ArtworkSummary | null,
): Promise<ClassificationState> {
  try {
    const row = await readClassification(db, productId);
    if (row) return { kind: "loaded", row };
  } catch (error) {
    Sentry.captureException(error);
    return { kind: "error" };
  }
  // The suggestion follows the extraction in the same job: while the latest artwork is still being read, it is coming.
  const reading = latest !== null && (latest.run === null || latest.run.status === "queued" || latest.run.status === "running");
  return reading ? { kind: "loading" } : { kind: "empty" };
}
