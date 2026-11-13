"use client";

// T-902 · J04: "Mark all read" on the alerts inbox (S-MIS-001). It records this person's read of every alert the page
// showed them unread; a colleague's read state is untouched (BE-39). The design draws it as mono caps in the toolbar.
import { useState, useTransition } from "react";
import { markAlertsRead, type MarkReadResult } from "@/lib/alerts/actions";

const REFUSAL: Record<Extract<MarkReadResult, { ok: false }>["reason"], string> = {
  "no-permission": "These alerts could not be marked read: one of them is no longer in your scope. Reload the page.",
  invalid: "These alerts could not be marked read. Reload the page.",
  error: "Nothing was marked read. Try again, and if it fails twice, tell us.",
};

export function MarkAllRead({ workspaceId, alertIds }: { workspaceId: string; alertIds: string[] }) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const press = () =>
    start(async () => {
      setRefusal(null);
      const result = await markAlertsRead(workspaceId, alertIds);
      if (!result.ok) setRefusal(REFUSAL[result.reason]);
    });
  return (
    <>
      <button
        type="button"
        onClick={press}
        disabled={pending}
        data-mark-all-read
        className="min-h-[24px] bg-transparent border-0 p-0 font-mono text-[10px] tracking-[0.05em] text-n600 cursor-pointer kit-transition hover:text-accent-700 disabled:cursor-progress"
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
