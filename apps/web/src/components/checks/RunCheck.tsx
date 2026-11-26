"use client";

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ErrorState, LoadingState, NoPermissionState } from "@/components/kit";
import { passLine, requestCheck, type CheckRefusal, type Readiness } from "@/lib/checks/run";
import { resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/client";

type State = { step: "idle" } | { step: "requesting" } | { step: "refused"; refusal: CheckRefusal } | { step: "opening"; jobId: string };

/**
 * S-NV2-002's closing bar (Nutrivo 2.0, screen "scope"): what one pass covers, "Re-check as often as you like", and
 * Run the check. The check is app.request_check and nothing else (D04 step 1, D08 step 2). Its progress is the
 * check-in-progress screen, S-NV2-024 at /checks/[job id], where this goes once the job exists (T-1111, issue 353).
 */
export function RunCheck({
  workspaceId,
  productId,
  markets,
  languages,
  readiness,
}: {
  workspaceId: string;
  productId: string;
  markets: number;
  languages: number;
  readiness: Readiness;
}) {
  const db = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ step: "idle" });
  const router = useRouter();
  // The design's own button (Nutrivo 2.0, scope): an accent-600 hairline, square, tracked 0.02em, beyond the kit's primary.
  const designed = {
    border: "1px solid var(--accent-600)",
    borderRadius: 0,
    letterSpacing: "0.02em",
    padding: "13px 26px",
    fontSize: 15,
    fontWeight: 600,
  };

  async function run() {
    setState({ step: "requesting" });
    const requestId = resolveRequestId(null);
    const result = await Sentry.startSpan({ name: "check.request", op: "rpc", attributes: { request_id: requestId } }, () =>
      requestCheck(db, productId, requestId),
    );
    if (!result.ok) {
      if (result.refusal.code === "unknown") Sentry.captureMessage("request_check failed", { tags: { request_id: requestId } });
      setState({ step: "refused", refusal: result.refusal });
      return;
    }
    if (posthog.__loaded) posthog.capture("check_requested", { job_id: result.jobId });
    setState({ step: "opening", jobId: result.jobId });
    router.push(`/w/${workspaceId}/products/${productId}/checks/${result.jobId}`);
  }

  const busy = state.step === "requesting" || state.step === "opening";

  return (
    <section aria-labelledby="run-the-check" data-run-check className="mt-[22px] border-t border-ink pt-[16px]">
      <div className="flex items-center gap-[16px] flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <h2 id="run-the-check" className="m-0 font-head text-[17px] font-semibold">
            {passLine(markets, languages)}
          </h2>
          <p className="mt-[3px] mb-0 text-[13px] text-n700">Re-check as often as you like. Checks are never metered.</p>
        </div>
        <Button
          variant="primary"
          size="md"
          style={designed}
          disabled={!readiness.ready || busy}
          aria-describedby={!readiness.ready ? "run-the-check-why" : undefined}
          onClick={() => void run()}
        >
          Run the check
        </Button>
      </div>

      {!readiness.ready ? (
        <p id="run-the-check-why" data-run-blocked className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
          {readiness.reason}
        </p>
      ) : null}

      <div className="mt-[12px] empty:hidden" aria-live="polite">
        {state.step === "requesting" ? <LoadingState label="Starting the check" /> : null}
        {state.step === "opening" ? <LoadingState label="Opening the check in progress" /> : null}
        {state.step === "refused" ? (
          state.refusal.code === "42501" ? (
            <NoPermissionState where="CHECK" title={state.refusal.title} body={state.refusal.body} aside="An admin can change your role." />
          ) : (
            <ErrorState where={`CHECK · ${state.refusal.code}`} title={state.refusal.title} body={state.refusal.body} />
          )
        ) : null}
      </div>
    </section>
  );
}
