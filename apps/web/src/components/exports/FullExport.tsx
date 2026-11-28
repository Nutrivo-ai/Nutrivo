"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { exportLink, requestExport } from "@/lib/exports/actions";
import { Button } from "@/components/kit";
import { formatBytes, formatWhen, type ExportState } from "@/lib/exports/exports";

// O03 (T-804): the full export's card, on S-WSS-004 Data and retention and S-NV2-018 Exports (T-1112).

const PREPARING_REFRESH_MS = 10_000;

/** "Everything, as files": request, preparing, ready (download for seven days), expired and failed. */
export function FullExport({ workspaceId, initial }: { workspaceId: string; initial: ExportState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const state = initial;

  // While the export is prepared, re-read the job every 10 s. docs/04 describes Postgres changes on app.jobs, but app.jobs
  // is not in the supabase_realtime publication yet, so a subscription would never fire.
  useEffect(() => {
    if (state.kind !== "preparing") return;
    const timer = window.setInterval(() => router.refresh(), PREPARING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [state, router]);

  function request() {
    setProblem(null);
    start(async () => {
      const result = await requestExport(workspaceId);
      if (!result.ok) {
        setProblem(
          result.problem ??
          (result.reason === "no-permission"
            ? "Only an internal admin with access to the whole workspace can request a full export."
            : "The export was not requested. Nothing changed; try again."),
        );
        return;
      }
      router.refresh();
    });
  }

  function download(jobId: string) {
    setProblem(null);
    start(async () => {
      const result = await exportLink(workspaceId, jobId);
      if (!result.ok) {
        setProblem(
          result.reason === "not-ready"
            ? "This export is no longer available. Request a new one."
            : "The download link could not be made. Try again.",
        );
        if (result.reason === "not-ready") router.refresh();
        return;
      }
      window.location.assign(result.value);
    });
  }

  return (
    <div className="border-l-[3px] border-accent pl-[13px]" data-export-state={state.kind}>
      <p className="m-0 text-[13.5px] font-semibold">Everything, as files</p>
      <p className="mt-[5px] mb-0 text-[12.5px] leading-[1.5] text-n700">
        Recipes, checks, findings, reports, certificates and documents, with the ruleset version on every row. Prepared
        within a day and downloadable for seven.
      </p>
      <div aria-live="polite">
        {state.kind === "preparing" ? (
          <p role="status" className="mt-[10px] mb-0 font-mono text-[10px] tracking-[0.08em] uppercase text-n600">
            Preparing · requested {formatWhen(state.requestedAt)}
          </p>
        ) : null}
        {state.kind === "ready" ? (
          <p className="mt-[10px] mb-0 font-mono text-[10px] tracking-[0.08em] uppercase text-n600">
            Ready{state.bytes !== null ? ` · ${formatBytes(state.bytes)}` : ""} · until {formatWhen(state.expiresAt)}
          </p>
        ) : null}
        {state.kind === "expired" ? (
          <p className="mt-[10px] mb-0 font-mono text-[10px] tracking-[0.08em] uppercase text-n600">
            The last export expired {formatWhen(state.expiredAt)}
          </p>
        ) : null}
        {state.kind === "failed" ? (
          <p role="alert" className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-blocked">
            {state.reason === "too_large"
              ? `The last export (${formatWhen(state.failedAt)}) was too large for one download, so it was not made rather than made incomplete. Nothing was lost.`
              : `The last export did not finish (${formatWhen(state.failedAt)}). Nothing was lost; request it again.`}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-blocked">
            {problem}
          </p>
        ) : null}
      </div>
      <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
        {state.kind === "ready" ? (
          <Button
            variant="secondary"
            className="border-accent text-accent-700 hover:bg-accent-100"
            disabled={pending}
            onClick={() => download(state.jobId)}
          >
            Download the export
          </Button>
        ) : null}
        {state.kind !== "preparing" ? (
          <Button
            variant={state.kind === "ready" ? "ghost" : "secondary"}
            className={state.kind === "ready" ? undefined : "border-accent text-accent-700 hover:bg-accent-100"}
            disabled={pending}
            aria-busy={pending}
            onClick={request}
          >
            {state.kind === "ready" ? "Request a new export" : "Request a full export"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
