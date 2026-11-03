"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { POLL_MS, TERMINAL, type JobRow } from "@/lib/artwork/progress";
import { describeCheckJob } from "./run";

type Db = SupabaseClient<Database>;

// A check job by its id, read under RLS (members read their workspace's jobs): Realtime on app.jobs where it is
// published, and a re-read every POLL_MS until the job is terminal, as the extraction progress does (#41).
export function useCheckJob(db: Db, jobId: string | null) {
  const [state, setState] = useState<{ jobId: string | null; row: JobRow | null; error: boolean }>({ jobId: null, row: null, error: false });

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = db
      .channel(`check-job:${jobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "app", table: "jobs", filter: `id=eq.${jobId}` }, (payload) => {
        if (!stopped) setState((prev) => (prev.jobId === jobId ? { ...prev, row: { ...(prev.row ?? {}), ...(payload.new as JobRow) } } : prev));
      })
      .subscribe();
    const poll = async () => {
      try {
        const { data, error } = await db
          .schema("app")
          .from("jobs")
          .select("id, status, progress, last_error, attempts")
          .eq("id", jobId)
          .maybeSingle();
        if (error) throw error;
        const row = (data as JobRow | null) ?? null;
        if (stopped) return;
        setState({ jobId, row, error: false });
        if (row && TERMINAL.has(row.status)) return;
      } catch {
        if (!stopped) setState((prev) => ({ jobId, row: prev.jobId === jobId ? prev.row : null, error: true }));
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [db, jobId]);

  const row = state.jobId === jobId ? state.row : null;
  return { view: describeCheckJob(row), error: state.jobId === jobId && state.error };
}
