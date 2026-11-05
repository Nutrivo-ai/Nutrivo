"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { EMPTY_WATCH, JOB_COLUMNS, visibleFor, watchJob, type JobRow, type JobSource, type WatchState } from "./watch";

type Db = SupabaseClient<Database>;

/** Which job: by its id (a check job), or by its idempotency key (an artwork version's extract job). */
export type JobRef = { id: string } | { key: string };

const refKey = (ref: JobRef | null) => (ref ? ("id" in ref ? `id:${ref.id}` : `key:${ref.key}`) : null);

/** The watcher's source over supabase-js under the person's session: reads and Realtime both go through RLS. */
export function supabaseJobSource(db: Db, ref: JobRef): JobSource {
  return {
    async read() {
      const query = db.schema("app").from("jobs").select(JOB_COLUMNS);
      const { data, error } = await ("id" in ref ? query.eq("id", ref.id) : query.eq("idempotency_key", ref.key)).maybeSingle();
      if (error) throw error;
      return (data as JobRow | null) ?? null;
    },
    subscribe(jobId, onUpdate, onStatus) {
      const channel = db
        .channel(`job:${jobId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "app", table: "jobs", filter: `id=eq.${jobId}` }, (payload) =>
          onUpdate(payload.new as Partial<JobRow>),
        )
        .subscribe((status, err) => onStatus(status as Parameters<typeof onStatus>[0], err));
      return () => void db.removeChannel(channel);
    },
  };
}

type HookState = WatchState & { ref: string | null; generation: number };

/**
 * One job kept current over Realtime (watch.ts). `generation` restarts the watch: after a retry the same job id is
 * queued again, and a watcher that stopped at `failed` must start over. Channel failures go to Sentry with the job's
 * area and the request id when there is one, never with the row.
 */
export function useJob(db: Db, ref: JobRef | null, opts: { area: string; requestId?: string; generation?: number }) {
  const key = refKey(ref);
  const generation = opts.generation ?? 0;
  const [state, setState] = useState<HookState>({ ...EMPTY_WATCH, ref: null, generation: 0 });
  const { area, requestId } = opts;

  useEffect(() => {
    if (!ref || !key) return;
    return watchJob(supabaseJobSource(db, ref), (next) => setState({ ...next, ref: key, generation }), {
      onChannelProblem: (status, error) =>
        Sentry.captureMessage("job realtime channel unavailable; re-reading instead", {
          level: "warning",
          tags: { area, channel_status: status, request_id: requestId ?? "none" },
          extra: { error: error?.message },
        }),
    });
    // ref is identified by key; a new object with the same key must not restart the watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, key, generation, area, requestId]);

  return visibleFor(state, key, generation);
}
