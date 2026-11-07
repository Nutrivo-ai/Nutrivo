"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { useJob } from "@/lib/jobs/useJob";
import { describeCheckJob } from "./run";

type Db = SupabaseClient<Database>;

// A check job by its id, read under RLS (members read their workspace's jobs) and kept current over Realtime, with
// the fallbacks in lib/jobs/watch.ts (T-305).
export function useCheckJob(db: Db, jobId: string | null, opts: { requestId?: string; generation?: number } = {}) {
  const state = useJob(db, jobId ? { id: jobId } : null, { area: "check", ...opts });
  return { view: describeCheckJob(state.row), error: state.error, stalled: state.stalled };
}
