// S-NV2-024 Check in progress (T-1111, D04), built against today's check job contract (docs/04 `check` row), per the
// founder's decision on issue 353 (option b): queued, then running with the time elapsed, then the job's terminal state,
// then on to the report. The job writes every app.checks row and its findings in one transaction at the end, and its
// `progress` carries only `outcome`, `checks` and the result sets per label state, so this screen shows no rule
// counts, no stage list and no running tallies: that data does not exist, and nothing here is made up.
import { describeCheckJob, type CheckJobView } from "./run";
import type { JobRow } from "@/lib/jobs/watch";

export type Counts = { checks: number; clear: number; action: number; notAssessed: number; again: boolean };

export type ProgressView =
  | { kind: "queued"; retrying: boolean }
  | { kind: "running" }
  /** Finished with at least one result set Clear or Action needed. */
  | ({ kind: "done" } & Counts)
  /** Finished, and nothing could be assessed: every result set is Not assessed (or there was none). Never Clear. */
  | ({ kind: "withheld" } & Counts)
  | { kind: "failed"; reason: string }
  /** Not terminal after the worker's lease (lib/jobs/watch.ts STALLED_AFTER_MS): said, never an endless spinner. */
  | { kind: "stalled" }
  /** No row has been read yet and the read failed. */
  | { kind: "unreadable" };

/** What the screen shows for the job as last read; `initial` is the row the server read, until the watcher has one. */
export function progressView(args: {
  row: JobRow | null;
  initial: JobRow;
  stalled: boolean;
  error: boolean;
}): ProgressView {
  const row = args.row ?? (args.error ? null : args.initial);
  if (!row) return { kind: "unreadable" };
  const view = describeCheckJob(row);
  return fromJob(view, args.stalled);
}

function fromJob(view: CheckJobView, stalled: boolean): ProgressView {
  switch (view.phase) {
    case "done": {
      const counts = { checks: view.checks, clear: view.clear, action: view.action, notAssessed: view.notAssessed, again: view.again };
      return counts.clear + counts.action > 0 ? { kind: "done", ...counts } : { kind: "withheld", ...counts };
    }
    case "failed":
      return { kind: "failed", reason: view.reason };
    case "waiting":
    case "queued":
      if (stalled) return { kind: "stalled" };
      return { kind: "queued", retrying: view.phase === "queued" && view.retrying };
    case "running":
      return stalled ? { kind: "stalled" } : { kind: "running" };
  }
}

export const isTerminal = (v: ProgressView) => v.kind === "done" || v.kind === "withheld" || v.kind === "failed";

/**
 * The screen moves on to the report by itself only when it watched the check finish with results to read: a job
 * already finished when the page opened, a withheld one (whose reasons the person should read here first) and a
 * failed one stay, each with its one action.
 */
export function movesOn(openedTerminal: boolean, view: ProgressView): boolean {
  return !openedTerminal && view.kind === "done";
}

/** How long the check has taken since it was requested: "41 seconds", "2 minutes 5 seconds", "1 hour 3 minutes". */
export function elapsed(fromIso: string, nowMs: number): string {
  const from = Date.parse(fromIso);
  const total = Number.isFinite(from) ? Math.max(0, Math.floor((nowMs - from) / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (h > 0) return m > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  if (m > 0) return s > 0 ? `${unit(m, "minute")} ${unit(s, "second")}` : unit(m, "minute");
  return unit(s, "second");
}

/** The card's heading, as the design words it: "Salmon & Rice Adult 12 kg · 9 nodes · 11 languages". */
export function scopeLine(product: string, markets: number, languages: number): string {
  const parts = [product, `${markets} node${markets === 1 ? "" : "s"}`];
  if (languages > 0) parts.push(`${languages} language${languages === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The header crumb per state, from the design's "Check your label · running". */
export function crumbFor(view: ProgressView): string {
  switch (view.kind) {
    case "queued":
      return "Check your label · queued";
    case "running":
    case "stalled":
    case "unreadable":
      return "Check your label · running";
    case "done":
      return "Check your label · checked";
    case "withheld":
      return "Check your label · withheld";
    case "failed":
      return "Check your label · not completed";
  }
}
