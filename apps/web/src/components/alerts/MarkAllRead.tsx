"use client";

// T-902 · J04: "Mark all read" on the alerts inbox (S-MIS-001). It records this person's read of every alert the page
// showed them unread; a colleague's read state is untouched (BE-39). The design draws it as mono caps in the toolbar.
import { useState, useTransition } from "react";
import { markAlertsRead, type MarkReadResult } from "@/lib/alerts/actions";

type Refusal = Extract<MarkReadResult, { ok: false }>;

const WHY: Record<Refusal["reason"], string> = {
  "no-permission": "one of them is no longer in your scope. Reload the page.",
  invalid: "reload the page and try again.",
  error: "try again, and if it fails twice, tell us.",
};

/** What a refused press says, naming any batches already recorded before the failure. */
export function refusalText(r: Refusal): string {
  if (r.marked > 0) {
    return `${r.marked} ${r.marked === 1 ? "alert was" : "alerts were"} marked read, then the rest could not be: ${WHY[r.reason]}`;
  }
  return `Nothing was marked read: ${WHY[r.reason]}`;
}

export function MarkAllRead({ workspaceId, alertIds, phone }: { workspaceId: string; alertIds: string[]; phone?: boolean }) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const press = () =>
    start(async () => {
      setRefusal(null);
      const result = await markAlertsRead(workspaceId, alertIds);
      if (!result.ok) setRefusal(refusalText(result));
    });
  return (
    <>
      <button
        type="button"
        onClick={press}
        disabled={pending}
        data-mark-all-read
        className={
          "bg-transparent p-0 font-mono text-[10px] tracking-[0.05em] text-n600 cursor-pointer kit-transition hover:text-accent-700 disabled:cursor-progress " +
          (phone ? "min-h-[44px] w-full border border-n400 rounded-control" : "min-h-[24px] border-0")
        }
      >
        {pending ? "MARKING…" : "MARK ALL READ"}
      </button>
      {refusal ? (
        <p role="alert" className="basis-full m-0 text-[12.5px] font-medium text-ink" data-mark-read-refused>
          {refusal}
        </p>
      ) : null}
    </>
  );
}
