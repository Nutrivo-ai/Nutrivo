"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// D01 step 4: extraction progress from app.jobs, read under RLS (read_member). docs/04 subscribes to Postgres changes
// on app.jobs filtered by id. Until app.jobs is in the supabase_realtime publication (asked on #41), no change event
// arrives, so the row is also re-read every POLL_MS until it is terminal; once the publication exists, Realtime
// delivers the same rows sooner and nothing else changes.

export const POLL_MS = 2000;

export type JobRow = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: Record<string, unknown>;
  last_error: string | null;
  attempts: number;
};

export type JobView =
  | { phase: "waiting" }
  | { phase: "queued"; retrying: boolean }
  | { phase: "running"; stage: string; label: string }
  | { phase: "done"; status: "succeeded" | "partial" | "failed"; panels: number; extracted: number; failureCodes: string[] }
  | { phase: "failed"; reason: string };

const STAGE_LABEL: Record<string, string> = {
  reading: "Reading the file",
  extracting: "Finding panels, languages and text",
  saving: "Saving panels and text objects",
  done: "Finished",
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export function describeJob(row: JobRow | null): JobView {
  if (!row) return { phase: "waiting" };
  const p = row.progress ?? {};
  if (row.status === "succeeded") {
    const status = p.status === "succeeded" || p.status === "partial" ? p.status : "failed";
    return {
      phase: "done",
      status,
      panels: num(p.panels),
      extracted: num(p.panels_extracted),
      failureCodes: Array.isArray(p.failure_codes) ? p.failure_codes.map(String) : [],
    };
  }
  if (row.status === "failed" || row.status === "cancelled") {
    return { phase: "failed", reason: safeReason(row.last_error) };
  }
  if (row.status === "running") {
    const stage = typeof p.stage === "string" && p.stage in STAGE_LABEL ? p.stage : "reading";
    return { phase: "running", stage, label: STAGE_LABEL[stage] };
  }
  return { phase: "queued", retrying: row.attempts > 0 };
}

/** last_error holds ids and reason codes only (worker errors.py); the person sees what it means, never the raw text. */
export function safeReason(lastError: string | null): string {
  if (lastError?.includes("missing from storage")) return "The file never reached storage. Upload it again.";
  if (lastError?.includes("registered hash")) return "The stored file is not the one that was registered. Upload it again.";
  return "Extraction stopped after its retries. Upload the file again; nothing is counted twice.";
}

export const TERMINAL = new Set<JobRow["status"]>(["succeeded", "failed", "cancelled"]);

type Db = SupabaseClient<Database>;

async function readJob(db: Db, artworkVersionId: string): Promise<JobRow | null> {
  const { data, error } = await db
    .schema("app")
    .from("jobs")
    .select("id, status, progress, last_error, attempts")
    .eq("idempotency_key", `extract:${artworkVersionId}`)
    .maybeSingle();
  if (error) throw error;
  return (data as JobRow | null) ?? null;
}

/** The extract job of an artwork version, kept current over Realtime and polling until it is terminal. */
export function useExtractJob(db: Db, artworkVersionId: string | null) {
  const [row, setRow] = useState<JobRow | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!artworkVersionId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<Db["channel"]> | undefined;

    const apply = (next: JobRow | null) => {
      if (stopped) return;
      setRow(next);
      setError(false);
      if (next && !channel) {
        channel = db
          .channel(`job:${next.id}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "app", table: "jobs", filter: `id=eq.${next.id}` },
            (payload) => !stopped && setRow((prev) => ({ ...(prev ?? next), ...(payload.new as JobRow) })),
          )
          .subscribe();
      }
    };
    const poll = async () => {
      try {
        const next = await readJob(db, artworkVersionId);
        apply(next);
        if (next && TERMINAL.has(next.status)) return;
      } catch {
        if (!stopped) setError(true);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (channel) void db.removeChannel(channel);
    };
  }, [db, artworkVersionId]);

  return { row, view: describeJob(row), error };
}
