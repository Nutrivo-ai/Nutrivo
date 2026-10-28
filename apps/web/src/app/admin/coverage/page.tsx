import { ScreenHeader } from "@/components/shell";
import { readDraft, readDrafts, readJurisdictions, releaseBlockers } from "@/lib/admin/reads";
import { staffReader } from "@/lib/admin/server";
import { CoverageConsole } from "./CoverageConsole";

// K04 coverage management and the K05 release, on a ruleset draft (T-204; no design yet, #35 question 1). Coverage is
// edited on a draft and published only by a release. Complete is refused by the database unless every member rule
// of that node and domain is accepted and tested (BE-10, P0010). The release is refused until the draft's fixture run
// passed (P0039); the screen lists what blocks it and shows the database's refusal as it is.
export default async function CoveragePage({ searchParams }: PageProps<"/admin/coverage">) {
  const { draft: asked, node: askedNode } = await searchParams;
  const db = await staffReader();
  const [{ drafts, latestRelease }, nodes] = await Promise.all([readDrafts(db), readJurisdictions(db)]);
  const draft = drafts.find((d) => d.id === asked) ?? drafts.find((d) => !d.released) ?? null;
  const detail = draft ? await readDraft(db, draft.id) : null;
  const coverageNodes = detail ? [...new Set(detail.coverage.map((c) => c.nodeId))].sort() : [];
  const node = typeof askedNode === "string" && coverageNodes.includes(askedNode) ? askedNode : (coverageNodes[0] ?? null);
  return (
    <>
      <ScreenHeader crumb="Content operations · K04–K05" title="Coverage and release" />
      <CoverageConsole
        drafts={drafts}
        latestRelease={latestRelease}
        draft={draft}
        detail={detail}
        blockers={detail ? releaseBlockers(detail) : []}
        nodes={nodes}
        coverageNodes={coverageNodes}
        node={node}
      />
    </>
  );
}
