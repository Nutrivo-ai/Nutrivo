import * as Sentry from "@sentry/nextjs";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { Envelope } from "@/components/briefs/Envelope";
import { EnvelopeProgress } from "@/components/briefs/EnvelopeProgress";
import { ScreenThisBrief } from "@/components/briefs/ScreenThisBrief";
import { EmptyState, ErrorState } from "@/components/kit";
import { Screen } from "@/components/shell";
import { readEnvelope, type EnvelopeRead } from "@/lib/briefs/queries";
import { createClient } from "@/lib/supabase/server";

// S-NV2-005 Design envelope (spec/screens.yaml), T-1002 · E02 Compute the compliance envelope: the latest envelope of
// the brief from accepted rules only, per market and language, with every withheld item and its gap. Viewers read it;
// "Screen this brief" asks for a new one through app.request_envelope (editors; the RPC decides). States: loading
// (loading.tsx), empty (never screened), screening (the job, over Realtime), error (the read, or a failed job),
// no-permission (the database's 42501 on screening), not found.
export default async function Page({ params }: PageProps<"/w/[workspace]/briefs/[product]/envelope">) {
  const { workspace, product: productId } = await params;
  const db = await createClient();
  let read: EnvelopeRead | null = null;
  let failed = false;
  try {
    read = await readEnvelope(db, workspace, productId);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "briefs", briefs_step: "read_envelope" } });
    failed = true;
  }
  const job = read?.job ?? null;
  return (
    <Screen
      route="/w/[workspace]/briefs/[product]/envelope"
      crumb="New product · Design envelope · Step 2 of 2"
      title={read ? `${read.product.name} — what you may build` : undefined}
    >
      {failed ? (
        <div className="max-w-[640px]">
          <ErrorState
            where="DESIGN ENVELOPE"
            title="The envelope could not be read"
            body="Nothing was changed. Reload the page to read it again."
            action={{ label: "Reload", href: `/w/${workspace}/briefs/${productId}/envelope`, variant: "primary" }}
          />
        </div>
      ) : !read ? (
        <ProductNotFound workspaceId={workspace} />
      ) : (
        <div className="flex flex-col gap-[18px]">
          {job && (job.status === "queued" || job.status === "running") ? <EnvelopeProgress jobId={job.id} /> : null}
          {job && job.status === "failed" ? (
            <div className="max-w-[640px]">
              <ErrorState
                where="DESIGN ENVELOPE"
                title="The brief could not be screened"
                body="The envelope job failed after its retries and wrote nothing. Screen the brief again; if it fails twice, tell us."
              />
            </div>
          ) : null}
          {read.envelope ? (
            <Envelope workspaceId={workspace} data={read.envelope} />
          ) : !job || job.status === "failed" || job.outcome === "superseded" ? (
            <div className="max-w-[640px]">
              <EmptyState
                where="DESIGN ENVELOPE"
                title="This brief has not been screened yet"
                body="Screening reads the accepted rules for each of the brief's markets: what it must carry, what it may say and the ceilings its additives must stay within. Anything not encoded is listed as not assessed. An envelope is for the brief as it stands: after a change to its formula, claims or markets, screen it again."
              />
            </div>
          ) : null}
          <div className="max-w-[360px]">
            <ScreenThisBrief
              workspaceId={workspace}
              productId={productId}
              label={read.envelope ? "Screen again" : "Screen this brief"}
            />
          </div>
        </div>
      )}
    </Screen>
  );
}
