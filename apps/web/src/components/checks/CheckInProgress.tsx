"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ButtonLink, ErrorState, StateGlyph } from "@/components/kit";
import { Screen } from "@/components/shell";
import { useCheckJob } from "@/lib/checks/progress";
import { crumbFor, elapsed, isTerminal, movesOn, progressView, scopeLine, type Counts, type ProgressView } from "@/lib/checks/inProgress";
import type { JobRow } from "@/lib/jobs/watch";
import { tileLabel } from "@/lib/report/model";
import { createClient } from "@/lib/supabase/client";

export const ROUTE = "/w/[workspace]/products/[product]/checks/[check]";

/** How long the finished state shows before the screen moves on to the report (only when it watched it finish). */
export const MOVE_ON_MS = 1_500;

export type CheckInProgressProps = {
  workspaceId: string;
  productId: string;
  product: string;
  markets: number;
  languages: number;
  rulesetVersion: string | null;
  /** The request_id private.enqueue stamped in the job's payload, so Sentry events carry it end to end (docs/17). */
  requestId: string | null;
  /** The job as the server read it under RLS; the watcher keeps it current over Realtime. */
  initial: JobRow & { created_at: string };
};

/**
 * S-NV2-024 (Nutrivo 2.0, screen "prog"): one check job (app.jobs, kind check) from queued to its terminal state, read
 * under RLS and kept current over Realtime (lib/jobs/watch.ts). Built against today's contract (issue 353, option b).
 */
export function CheckInProgress(props: CheckInProgressProps) {
  const db = useMemo(() => createClient(), []);
  const router = useRouter();
  const [generation, setGeneration] = useState(0);
  const job = useCheckJob(db, props.initial.id, { generation, requestId: props.requestId ?? undefined });
  const view = progressView({ row: job.row, initial: props.initial, stalled: job.stalled, error: job.error });
  const [openedTerminal] = useState(() => isTerminal(progressView({ row: null, initial: props.initial, stalled: false, error: false })));
  // The elapsed time is the running card's alone: a finished job's own duration is not in what the page reads.
  const now = useNow(!isTerminal(view));
  const report = `/w/${props.workspaceId}/products/${props.productId}/report`;
  const moving = movesOn(openedTerminal, view);

  useEffect(() => {
    if (!moving) return;
    const t = setTimeout(() => router.push(report), MOVE_ON_MS);
    return () => clearTimeout(t);
  }, [moving, report, router]);

  useEffect(() => {
    if (view.kind === "stalled") Sentry.captureMessage("check job not terminal after the lease", { level: "warning", tags: { area: "check", job_id: props.initial.id, request_id: props.requestId ?? "none" } });
  }, [view.kind, props.initial.id, props.requestId]);

  return (
    <Screen
      route={ROUTE}
      crumb={crumbFor(view)}
      aside={props.rulesetVersion ? <RulesetPin version={props.rulesetVersion} /> : undefined}
    >
      <CheckProgressView
        {...props}
        view={view}
        took={now === null ? null : elapsed(props.initial.created_at, now)}
        moving={moving}
        report={report}
        onCheckAgain={() => setGeneration((g) => g + 1)}
      />
    </Screen>
  );
}

/** The clock for the elapsed time: started after mount (no server/client mismatch) and stopped once terminal. */
function useNow(ticking: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = ticking ? setInterval(tick, 1_000) : undefined;
    return () => {
      clearTimeout(first);
      if (every) clearInterval(every);
    };
  }, [ticking]);
  return now;
}

function RulesetPin({ version }: { version: string }) {
  return (
    <span data-ruleset className="font-mono text-[10.5px] tracking-[0.04em] text-n700 border border-rule py-[6px] px-[9px]">
      RULESET {version} · pinned
    </span>
  );
}

const label = "m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600";

/** The screen without its data plumbing, so every state renders in a unit test. */
export function CheckProgressView({
  workspaceId,
  productId,
  product,
  markets,
  languages,
  view,
  took,
  moving,
  report,
  onCheckAgain,
}: Omit<CheckInProgressProps, "initial" | "rulesetVersion" | "requestId"> & {
  view: ProgressView;
  took: string | null;
  moving: boolean;
  report: string;
  onCheckAgain: () => void;
}) {
  const scope = scopeLine(product, markets, languages);
  const back = `/w/${workspaceId}/products/${productId}/check`;
  return (
    <div
      data-region="check-progress"
      data-progress={view.kind}
      className="grid gap-[22px] items-start md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:max-w-[948px]"
    >
      <div aria-live="polite" className="min-w-0">
        {view.kind === "queued" || view.kind === "running" ? (
          <section data-check-running aria-labelledby="check-scope" className="border border-ink py-[18px] px-[20px]" aria-busy="true">
            <p className={label}>
              {view.kind === "running" ? "Running" : view.retrying ? "Queued · waiting to try again" : "Queued"}
              {took ? <span data-elapsed> · {took} elapsed</span> : null}
            </p>
            <h2 id="check-scope" className="mt-[8px] mb-0 font-head text-[24px] font-semibold leading-[1.15]">
              {scope}
            </h2>
            <p className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
              Every market and printed language panel is answered together, and the results are written at once when the check
              finishes. Nothing here is a verdict until then, and a market that cannot be answered will say so rather than wait.
            </p>
          </section>
        ) : null}

        {view.kind === "done" || view.kind === "withheld" ? (
          <section
            data-check-terminal={view.kind}
            aria-labelledby="check-scope"
            className="border border-ink py-[18px] px-[20px]"
          >
            <p className={label}>
              {terminalLabel(view.kind, view.again)}
            </p>
            <h2 id="check-scope" className="mt-[8px] mb-0 font-head text-[24px] font-semibold leading-[1.15]">
              {scope}
            </h2>
            <p className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
              {view.kind === "done"
                ? `${resultSets(view.checks)}, one per market and printed language panel. The report shows every finding with its rule, citation and provenance.`
                : view.checks === 0
                  ? "No result set was written, so nothing was assessed and no answer was given. Nothing is Clear."
                  : `${resultSets(view.checks)}, and every one is Not assessed, so no answer was given. The report gives each one's reason. Nothing is Clear.`}
            </p>
            <div className="mt-[14px] flex items-center gap-[12px] flex-wrap">
              <ButtonLink href={report} variant="primary" size="md">
                Open the report
              </ButtonLink>
              {moving ? (
                <span data-moving-on className="font-mono text-[10.5px] tracking-[0.04em] text-n600">
                  OPENING THE REPORT
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {view.kind === "failed" ? (
          <ErrorState
            where="CHECK · NOT COMPLETED"
            title="The check did not finish"
            body={view.reason}
            action={{ label: "Back to upload & scope", href: back, variant: "primary" }}
          />
        ) : null}

        {view.kind === "stalled" ? (
          <ErrorState
            where="CHECK · STILL RUNNING"
            title="This is taking longer than usual"
            body="The check has not finished yet. Nothing is lost and nothing was counted; the worker picks it up again on its own, and leaving this screen does not stop it."
            action={{ label: "Check again", onClick: onCheckAgain }}
          />
        ) : null}

        {view.kind === "unreadable" ? (
          <ErrorState
            where="CHECK · PROGRESS"
            title="Progress cannot be read just now"
            body="The check carries on whether or not this screen can read it. Nothing was counted."
            action={{ label: "Check again", onClick: onCheckAgain }}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-[18px]">
        {view.kind === "done" || view.kind === "withheld" ? <Results counts={view} /> : null}
        {isTerminal(view) ? null : (
          <aside data-neutral-note className="border border-rule py-[16px] px-[18px] bg-panel">
            <p className={label}>In progress is neutral</p>
            <p className="mt-[8px] mb-0 text-[12.5px] leading-[1.55] text-n700">
              A running stage is grey and mono. There is no fifth state, and nothing on this screen borrows a verdict colour it
              has not earned.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

/** The finished card's label: withheld is always named, also when the same check was asked again. */
export function terminalLabel(kind: "done" | "withheld", again: boolean): string {
  const again_ = "Already checked · this revision, ruleset and scope";
  if (kind === "withheld") return again ? `Withheld · nothing could be assessed · ${again_.toLowerCase()}` : "Withheld · nothing could be assessed";
  return again ? again_ : "Checked";
}

const resultSets = (n: number) => `${n} result set${n === 1 ? "" : "s"}`;

/** The finished job's counts (progress: result sets per label state), each with its glyph and name. No Blocked tile:
 * blocked is a market's registration state, which a check job does not count. */
function Results({ counts }: { counts: Counts }) {
  const tiles = [
    { state: "clear" as const, n: counts.clear, name: tileLabel("clear"), text: "text-clear", bg: "bg-clear-bg", edge: "border-t-clear" },
    { state: "action" as const, n: counts.action, name: tileLabel("action"), text: "text-action", bg: "bg-action-bg", edge: "border-t-action" },
    { state: "not_assessed" as const, n: counts.notAssessed, name: tileLabel("not_assessed"), text: "text-na", bg: "bg-na-bg", edge: "border-t-na" },
  ];
  return (
    <section data-results aria-labelledby="results-heading" className="border border-ink py-[16px] px-[18px]">
      <h2 id="results-heading" className={label}>
        Result sets
      </h2>
      <ul className="mt-[12px] mb-0 p-0 list-none grid grid-cols-2 gap-[10px]">
        {tiles.map((t) => (
          <li key={t.state} data-count={t.state} className={`border border-rule border-t-[3px] ${t.edge} ${t.bg} py-[10px] px-[12px]`}>
            <p className={`m-0 font-head text-[26px] font-semibold leading-none ${t.text}`}>{t.n}</p>
            <p className={`mt-[5px] mb-0 flex items-center gap-[6px] font-mono text-[9.5px] tracking-[0.08em] uppercase ${t.text}`}>
              <StateGlyph state={t.state} size="sm" />
              {t.name}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-[12px] mb-0 text-[12px] leading-[1.5] text-n600">
        One result set per market and printed language panel. Registration is separate, and shows on the report.
      </p>
    </section>
  );
}
