"use client";

// T-1002: the envelope job, followed over Realtime (lib/jobs). When it finishes the page is read again, so the new
// envelope (or the failure) shows without a reload. Neutral while it runs: never the accent, never a state colour.
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { LoadingState } from "@/components/kit";
import { useJob } from "@/lib/jobs/useJob";
import { createClient } from "@/lib/supabase/client";

export function EnvelopeProgress({ jobId }: { jobId: string }) {
  const db = useMemo(() => createClient(), []);
  const router = useRouter();
  const { row } = useJob(db, { id: jobId }, { area: "envelope" });
  const status = row?.status;
  useEffect(() => {
    if (status === "succeeded" || status === "failed" || status === "cancelled") router.refresh();
  }, [status, router]);
  return (
    <div data-envelope-job={status ?? "queued"}>
      <LoadingState label={status === "running" ? "SCREENING · RUNNING" : "SCREENING · QUEUED"}>
        Reading the accepted rules for each market against this brief. Anything not encoded will be listed as not
        assessed, with its gap.
      </LoadingState>
    </div>
  );
}
