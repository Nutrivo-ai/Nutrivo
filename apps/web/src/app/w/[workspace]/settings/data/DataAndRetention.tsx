"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Blueprint, Button, NoPermissionState } from "@/components/kit";
import { ScreenHeader, useShell } from "@/components/shell";
import { ROLE_LABEL, roleAllows, routeFor } from "@/lib/shell/routes";
import { formatBytes, formatWhen, type ExportState } from "@/lib/exports/exports";
import { exportLink, requestExport } from "./actions";

// The design's retention list, word for word (Workspace Settings, `retention`).
const RETENTION: { k: string; v: string; tag: string; tone: "clear" | "action" | "n600" }[] = [
  {
    k: "Checks, findings and reports",
    v: "Kept for as long as the workspace exists, and beyond it while any report is still resolvable. A check is an event in an append-only store, so it cannot be edited or removed by anyone including us.",
    tag: "PERMANENT",
    tone: "clear",
  },
  {
    k: "Certificates of Check",
    v: "Permanent, in a chain that only accepts inserts. A material ruleset change marks a certificate superseded; it never makes one disappear.",
    tag: "PERMANENT",
    tone: "clear",
  },
  {
    k: "Artwork files you upload",
    v: "Held while the recipe is active and for two years after it is discontinued. The extracted text, the geometry and the artwork hash are kept permanently, because that is what a report was pinned to.",
    tag: "2 YEARS AFTER",
    tone: "action",
  },
  {
    k: "Supplier documents and specifications",
    v: "Held while the document is current and for six years after its expiry, which is the span most audits reach back over.",
    tag: "6 YEARS",
    tone: "n600",
  },
  {
    k: "Recipes marked discontinued",
    v: "Never deleted. Excluded from counts, freshness and monitoring, and kept resolvable because certificates were issued against them.",
    tag: "PERMANENT",
    tone: "clear",
  },
  {
    k: "People who have left",
    v: "Their access ends at once. Their name stays on every check they ran and every document they signed, for the same reason the history is append-only.",
    tag: "NAME KEPT",
    tone: "n600",
  },
];

const PREPARING_REFRESH_MS = 10_000;

const TONE = { clear: "border-clear text-clear", action: "border-action text-action", n600: "border-n600 text-n600" };

export function DataAndRetention({
  route,
  workspaceId,
  initial,
}: {
  route: string;
  workspaceId: string;
  initial: ExportState;
}) {
  const screen = routeFor(route);
  const { current } = useShell();
  const allowed = roleAllows(current.role, screen.role);
  return (
    <>
      <ScreenHeader crumb={current.name} title={screen.title} />
      <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
        {allowed ? (
          <>
            <Blueprint edge="border-l-4 border-l-clear" className="bg-clear-bg py-[18px] px-[22px]">
              <p className="m-0 text-[15px] font-semibold">How long we keep things, and why some of it is permanent</p>
              <p className="mt-[7px] mb-0 text-[13.5px] leading-[1.6] text-n800 max-w-[106ch]">
                A report you sent may be held by a retailer, an authority or an artwork agency who has no account with
                us. If our record of it could be deleted, their copy would become unverifiable, so the parts a report
                was pinned to are kept for good.
              </p>
            </Blueprint>
            <div className="mt-[20px] grid gap-[20px] items-start grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
              <Blueprint as="section">
                <div className="py-[16px] px-[20px] border-b border-ink">
                  <h2 className="m-0 text-[16px] font-semibold">Retention</h2>
                  <p className="mt-[4px] mb-0 font-mono text-[10.5px] tracking-[0.05em] text-n600">
                    STATED PER KIND OF RECORD · NOT ONE BLANKET PERIOD
                  </p>
                </div>
                <ul className="m-0 p-0 list-none">
                  {RETENTION.map((r) => (
                    <li key={r.k} className="py-[15px] px-[20px] border-b border-n200">
                      <div className="flex items-baseline justify-between gap-[16px]">
                        <h3 className="m-0 text-[14px] font-semibold">{r.k}</h3>
                        <span
                          className={`flex-none font-mono text-[9.5px] tracking-[0.06em] border bg-paper py-[4px] px-[7px] whitespace-nowrap ${TONE[r.tone]}`}
                        >
                          {r.tag}
                        </span>
                      </div>
                      <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">{r.v}</p>
                    </li>
                  ))}
                </ul>
              </Blueprint>
              <div className="flex flex-col gap-[18px]">
                <Blueprint as="section" className="py-[20px] px-[22px]">
                  <h2 className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-accent font-normal">
                    Take it with you
                  </h2>
                  <div className="mt-[13px] flex flex-col gap-[14px]">
                    <FullExport workspaceId={workspaceId} initial={initial} />
                  </div>
                  <p className="mt-[15px] mb-0 pt-[13px] border-t border-n200 text-[12.5px] leading-[1.5] text-n700">
                    Your data is yours and exporting it is free on every plan, including the free one. A tool that
                    holds your compliance history hostage is not one you should trust with it.
                  </p>
                </Blueprint>
                <Blueprint edge="border-l-4 border-l-na" className="py-[18px] px-[20px]">
                  <p className="m-0 text-[13.5px] font-semibold">Where it is held</p>
                  <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
                    In the EU, in one database, with your workspace separated from every other at the row level rather
                    than by application code. Sub-processors are listed in the terms and we tell you before one
                    changes.
                  </p>
                </Blueprint>
              </div>
            </div>
          </>
        ) : (
          <div className="max-w-[640px]">
            <NoPermissionState
              where="NO PERMISSION · SETTINGS"
              title={`Your role cannot open ${screen.title}`}
              body={`You are ${/^[aeiou]/i.test(ROLE_LABEL[current.role]) ? "an" : "a"} ${ROLE_LABEL[current.role]} in ${current.name}. Data and retention, and the full export, need an ${ROLE_LABEL.admin}.`}
              aside={`An admin of ${current.name} can request an export or change your role.`}
            />
          </div>
        )}
      </main>
    </>
  );
}

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
          result.reason === "no-permission"
            ? "Only an admin can request a full export."
            : "The export was not requested. Nothing changed; try again.",
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
