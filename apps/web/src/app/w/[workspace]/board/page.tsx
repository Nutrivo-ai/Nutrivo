import * as Sentry from "@sentry/nextjs";
import { Board } from "@/components/board/Board";
import { RulesetChip } from "@/components/coverage/RulesetChip";
import { Screen } from "@/components/shell";
import { parseFilters } from "@/lib/board/model";
import { readBoard } from "@/lib/board/queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Board · Nutrivo" };

// S-NV2-006 Board (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "board"). F01: products × markets
// grouped by region, region cells from app.rollup_state; F04: the open findings across the portfolio (?view=findings).
// Read under RLS. A read failure goes to the workspace error boundary, and loading.tsx covers the wait. S-MIS-003
// (search, saved views) is F02, LATER; S-MOB-001 waits for a roll-up across a whole product in the database (#56 q4).
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/board">) {
  const { workspace } = await params;
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();
  const page = await Sentry.startSpan({ name: "board.read", op: "db.read", attributes: { view: filters.view } }, () =>
    readBoard(supabase, workspace, filters),
  );
  if (page.kind === "not-found") return null; // the workspace layout has already shown NoAccess
  const { board } = page;
  return (
    <Screen
      route="/w/[workspace]/board"
      title={
        board.productCount
          ? `${board.productCount} ${board.productCount === 1 ? "product" : "products"} × ${board.marketCount} jurisdiction ${board.marketCount === 1 ? "node" : "nodes"}`
          : undefined
      }
      aside={<RulesetChip version={board.currentRuleset} current />}
    >
      <Board workspaceId={workspace} page={page} />
    </Screen>
  );
}
