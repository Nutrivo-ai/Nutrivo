import * as Sentry from "@sentry/nextjs";
import { CheckInProgress } from "@/components/checks/CheckInProgress";
import { NoPermissionState } from "@/components/kit";
import { Screen } from "@/components/shell";
import { isUuid, readArtwork, readPanels, readProduct } from "@/lib/artwork/queries";
import type { JobRow, JobStatus } from "@/lib/jobs/watch";
import { createClient } from "@/lib/supabase/server";
import { ShellReadError } from "@/lib/workspace/memberships";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Check in progress · Nutrivo" };

type Db = Awaited<ReturnType<typeof createClient>>;

// S-NV2-024 Check in progress (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "prog"), T-1111, D04.
// [check] is the app.jobs id of the product's check job (issue 353, option b): RunCheck comes here after app.request_check.
// Everything is read under the person's session: a job of another workspace or product, or one about a market outside
// their scope (app.jobs read_scoped, T-409), is not returned, and reads the same as one that never existed. A read
// failure goes to the workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/checks/[check]">) {
  const { workspace, product: productId, check } = await params;
  const db = await createClient();
  const data = await Sentry.startSpan({ name: "check_progress.read", op: "db.read" }, () => read(db, workspace, productId, check));
  if (!data) {
    return (
      <Screen route="/w/[workspace]/products/[product]/checks/[check]">
        <div className="max-w-[640px]" data-region="check-not-found">
          <NoPermissionState
            where="CHECK"
            title="This check is not one you can open"
            body="It may belong to another product or workspace, cover a market outside your scope, or the link may be wrong. Nothing about it is shown."
            aside="An admin of this workspace can change your market scope."
          />
        </div>
      </Screen>
    );
  }
  return <CheckInProgress workspaceId={workspace} productId={productId} {...data} />;
}

async function read(db: Db, workspaceId: string, productId: string, jobId: string) {
  if (!isUuid(jobId) || !isUuid(productId)) return null;
  const product = await readProduct(db, workspaceId, productId);
  if (!product) return null;
  const { data: job, error } = await db
    .schema("app")
    .from("jobs")
    .select("id, kind, status, progress, last_error, attempts, created_at, node_ids, payload")
    .eq("id", jobId)
    .eq("kind", "check")
    .eq("product_id", product.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new ShellReadError("check job", error);
  if (!job) return null;
  const payload = (job.payload ?? {}) as { artwork_version_id?: string; ruleset_version?: string; request_id?: string };
  return {
    product: product.name,
    markets: (job.node_ids ?? []).length,
    languages: await printedLanguages(db, product.id, payload.artwork_version_id),
    rulesetVersion: typeof payload.ruleset_version === "string" ? payload.ruleset_version : null,
    // private.enqueue stamps the request that queued the job; carried on so the watcher's events keep it (docs/17).
    requestId: typeof payload.request_id === "string" ? payload.request_id : null,
    initial: {
      id: job.id,
      status: job.status as JobStatus,
      progress: (job.progress ?? {}) as Record<string, unknown>,
      last_error: job.last_error,
      attempts: job.attempts,
      created_at: job.created_at,
    } satisfies JobRow & { created_at: string },
  };
}

/** The printed languages of the checked artwork's extracted panels: the heading's "× N languages". */
async function printedLanguages(db: Db, productId: string, artworkId: string | undefined): Promise<number> {
  if (!artworkId) return 0;
  const artwork = await readArtwork(db, productId, artworkId);
  const run = artwork?.run;
  if (!run || (run.status !== "succeeded" && run.status !== "partial")) return 0;
  const panels = await readPanels(db, run.id);
  return new Set(panels.filter((p) => p.status === "extracted" && p.language).map((p) => p.language)).size;
}
