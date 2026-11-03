import * as Sentry from "@sentry/nextjs";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { CoverageTable } from "@/components/coverage/CoverageTable";
import { RulesetChip } from "@/components/coverage/RulesetChip";
import { Screen } from "@/components/shell";
import { readLibraryCoverage } from "@/lib/coverage/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-013 Coverage & confidence (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "coverage"). D09:
// with ?product=, that product's markets at the ruleset each was last checked against; without, every node at the
// latest release. Both read the rows public.coverage_snapshot() publishes (BE-10). A read failure goes to the
// workspace error boundary, and loading.tsx covers the wait.
const ROUTE = "/w/[workspace]/library/coverage";

export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/library/coverage">) {
  const { workspace } = await params;
  const product = (await searchParams).product;
  const productId = typeof product === "string" && product ? product : null;
  const db = await createClient();
  const page = await Sentry.startSpan({ name: "coverage.read", op: "db.read" }, () => readLibraryCoverage(db, workspace, productId));
  if (page.kind === "not-found") {
    return (
      <Screen route={ROUTE}>
        <ProductNotFound workspaceId={workspace} />
      </Screen>
    );
  }
  return (
    <Screen
      route={ROUTE}
      crumb={page.product ? `Library · coverage & confidence · ${page.product.name}` : "Library · coverage & confidence"}
      title={page.product ? `What is encoded for ${page.product.name}` : "What is encoded, and what is not"}
      aside={<RulesetChip version={page.latest} current />}
    >
      <CoverageTable workspaceId={workspace} page={page} />
    </Screen>
  );
}
