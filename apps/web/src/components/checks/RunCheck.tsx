"use client";

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useMemo, useState } from "react";
import { Button, ButtonLink, ErrorState, LoadingState, NoPermissionState } from "@/components/kit";
import { useCheckJob } from "@/lib/checks/progress";
import { passLine, requestCheck, type CheckRefusal, type Readiness } from "@/lib/checks/run";
import { resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/client";

type State = { step: "idle" } | { step: "requesting" } | { step: "refused"; refusal: CheckRefusal } | { step: "running"; jobId: string; requestId: string };

/**
 * S-NV2-002's closing bar (Nutrivo 2.0, screen "scope"): what one pass covers, "Re-check as often as you like", and
 * Run the check. The check is app.request_check and nothing else (D04 step 1, D08 step 2); its progress shows here,
 * because the check-in-progress screen (S-NV2-024) is D04's, and the report link appears when it finishes (#55 q5).
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
  const [generation, setGeneration] = useState(0);
  const job = useCheckJob(db, state.step === "running" ? state.jobId : null, {
    requestId: state.step === "running" ? state.requestId : undefined,
    generation,
  });
  const report = `/w/${workspaceId}/products/${productId}/report`;
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
    setState({ step: "running", jobId: result.jobId, requestId });
  }

  const view = state.step === "running" ? job.view : null;
  const busy = state.step === "requesting" || (view !== null && view.phase !== "done" && view.phase !== "failed");
  const done = view?.phase === "done" ? view : null;

  return (
    <section aria-labelledby="run-the-check" data-run-check className="mt-[22px] border-t border-ink pt-[16px]">
      <div className="flex items-center gap-[16px] flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <h2 id="run-the-check" className="m-0 font-head text-[17px] font-semibold">
            {passLine(markets, languages)}
          </h2>
          <p className="mt-[3px] mb-0 text-[13px] text-n700">Re-check as often as you like. Checks are never metered.</p>
        </div>
        {done ? (
          <ButtonLink href={report} variant="primary" size="md" className="py-[13px] px-[26px] text-[15px] font-semibold">
            Open the report
          </ButtonLink>
        ) : (
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
        )}
      </div>

      {!readiness.ready && !done ? (
        <p id="run-the-check-why" data-run-blocked className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
          {readiness.reason}
        </p>
      ) : null}

      <div className="mt-[12px] empty:hidden" aria-live="polite">
        {state.step === "requesting" ? <LoadingState label="Starting the check" /> : null}
        {view && job.stalled && (view.phase === "waiting" || view.phase === "queued" || view.phase === "running") ? (
          <ErrorState
            where="CHECK · STILL RUNNING"
            title="This is taking longer than usual"
            body="The check has not finished yet. Nothing is lost and nothing was counted; the worker picks it up again on its own, and leaving this screen does not stop it."
            action={{ label: "Check again", onClick: () => setGeneration((g) => g + 1), variant: "secondary" }}
          />
        ) : null}
        {view && !job.stalled && (view.phase === "waiting" || view.phase === "queued" || view.phase === "running") ? (
          <LoadingState
            label={view.phase === "running" ? "Checking every market and language panel" : view.phase === "queued" && view.retrying ? "Waiting to try again" : "Queued for checking"}
          >
            {job.error
              ? "Progress cannot be read just now; the check carries on, and this updates when it can."
              : "Leaving this screen does not stop it. Nothing here is a verdict until every market reports."}
          </LoadingState>
        ) : null}
        {done ? (
          <p data-check-done className="m-0 font-mono text-[11px] tracking-[0.04em] text-n700">
            {done.again ? "ALREADY CHECKED · THIS REVISION, RULESET AND SCOPE" : "CHECKED"} · {done.checks} RESULT SET{done.checks === 1 ? "" : "S"} ·{" "}
            {done.action} ACTION · {done.notAssessed} NOT ASSESSED · {done.clear} CLEAR
          </p>
        ) : null}
        {view?.phase === "failed" ? (
          <ErrorState where="CHECK · NOT COMPLETED" title="The check did not finish" body={view.reason} />
        ) : null}
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
