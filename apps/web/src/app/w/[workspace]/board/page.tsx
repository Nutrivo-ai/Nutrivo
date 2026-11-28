import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { Board, BoardError, BoardNoAccess } from "@/components/board/Board";
import { Screen } from "@/components/shell";
import { boardHref, parseFilters } from "@/lib/board/model";
import { BoardReadError, readBoard } from "@/lib/board/queries";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Board · Nutrivo" };

// S-MTX-001 Board as the product matrix (D-33, T-1113; design: product/Nutrivo Board.dc.html and its state frames,
// S-MTX-002 to 011). F01: products by markets, each cell app.product_nodes' label line and registration line as stored;
// F04: the open findings across the portfolio (?view=findings). Read under RLS. loading.tsx covers the wait; a read
// that fails shows the design's error state with the response's request id (S-MTX-010) and goes to Sentry.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/board">) {
  const { workspace } = await params;
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();
  const requestId = (await headers()).get(REQUEST_ID_HEADER);
  const screen = (body: React.ReactNode) => (
    <Screen route="/w/[workspace]/board" crumb="Board" title="Products and markets">
      {body}
    </Screen>
  );
  let page: Awaited<ReturnType<typeof readBoard>>;
  try {
    page = await Sentry.startSpan(
      { name: "board.read", op: "db.read", attributes: { view: filters.view, request_id: requestId ?? "none" } },
      () => readBoard(supabase, workspace, filters),
    );
  } catch (error) {
    if (!(error instanceof BoardReadError)) throw error;
    Sentry.captureException(error, { tags: { screen: "S-MTX-001", request_id: requestId ?? "none" } });
    return screen(<BoardError retryHref={boardHref(workspace, filters)} requestId={requestId} />);
  }
  if (page.kind === "not-found") return screen(<BoardNoAccess />);
  return screen(<Board workspaceId={workspace} page={page} />);
}
