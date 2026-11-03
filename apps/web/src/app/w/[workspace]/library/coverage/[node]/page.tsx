import * as Sentry from "@sentry/nextjs";
import { CoverageNode } from "@/components/coverage/CoverageNode";
import { RulesetChip } from "@/components/coverage/RulesetChip";
import { EmptyState } from "@/components/kit";
import { Screen } from "@/components/shell";
import { readNodeCoverage } from "@/lib/coverage/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-021 Coverage node (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "cov"). D09 and D07.must.2:
// every Not assessed finding links here, to the gap by its id. ?ruleset= reads the node at a pinned ruleset (from a
// product's coverage); otherwise the latest release, the same rows as the public page (BE-10).

export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/library/coverage/[node]">) {
  const { workspace, node } = await params;
  const ruleset = (await searchParams).ruleset;
  const db = await createClient();
  const page = await Sentry.startSpan({ name: "coverage.node.read", op: "db.read" }, () =>
    readNodeCoverage(db, decodeURIComponent(node), typeof ruleset === "string" && ruleset ? ruleset : null),
  );
  if (page.kind === "not-found") {
    return (
      <Screen route="/w/[workspace]/library/coverage/[node]">
        <div className="max-w-[640px]">
          <EmptyState
            where="COVERAGE · NODE"
            title="There is no such coverage node"
            body="This market or ruleset is not in the coverage table. The coverage table lists every market we encode, and the gaps we know about by name."
            action={{ label: "Coverage & confidence", href: `/w/${workspace}/library/coverage` }}
          />
        </div>
      </Screen>
    );
  }
  return (
    <Screen route="/w/[workspace]/library/coverage/[node]" crumb="Library · coverage" title={`${page.row.name}: what is encoded`} aside={<RulesetChip version={page.row.rulesetVersion} current={page.row.rulesetVersion === page.latest} />}>
      <CoverageNode row={page.row} />
    </Screen>
  );
}
