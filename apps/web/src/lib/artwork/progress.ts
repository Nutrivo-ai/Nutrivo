"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { useJob } from "@/lib/jobs/useJob";
import type { JobRow } from "@/lib/jobs/watch";

// D01 step 4: extraction progress from app.jobs, read under RLS (read_member) and kept current over Realtime
// (lib/jobs/watch.ts, T-305). The job is found by its key, extract:<artwork_version_id>; a retry reuses it.

export { TERMINAL, type JobRow } from "@/lib/jobs/watch";

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
// Re-registering the same bytes returns the same artwork version and its finished job, so no copy here offers to
// upload the same file again; app.retry_extraction (T-305) runs the same job again instead.
export function safeReason(lastError: string | null): string {
  const after = "Nothing on this file is assessed, and nothing was counted twice. Retry the extraction, or upload a different file, such as a fresh export of the label.";
  if (lastError?.includes("missing from storage")) return `The file never reached storage, so it could not be read. ${after}`;
  if (lastError?.includes("registered hash")) return `The stored file is not the one that was registered, so it was not read. ${after}`;
  if (lastError?.includes("not this artwork's own")) return `The file is not stored where this product's artwork belongs, so it was not read. ${after}`;
  return `Extraction stopped after its retries. ${after}`;
}

type Db = SupabaseClient<Database>;

/** The extract job of an artwork version. `generation` restarts the watch after a retry. */
export function useExtractJob(db: Db, artworkVersionId: string | null, opts: { generation?: number; requestId?: string } = {}) {
  const state = useJob(db, artworkVersionId ? { key: `extract:${artworkVersionId}` } : null, { area: "extraction", ...opts });
  return { row: state.row, view: describeJob(state.row), error: state.error, stalled: state.stalled, live: state.live };
}
