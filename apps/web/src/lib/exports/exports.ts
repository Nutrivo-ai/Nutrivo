// O03 · Export everything (T-804). The latest export job of a workspace, read under the person's session (RLS), as the
// state S-WSS-004 shows. The job holds the archive's storage path only; a signed link is made on demand (actions.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** docs/04 and docs/09: an export is downloadable for seven days. */
export const EXPORT_TTL_S = 7 * 24 * 60 * 60;

export type ExportJobRow = {
  id: string;
  status: string;
  progress: unknown;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ExportState =
  | { kind: "none" }
  | { kind: "preparing"; jobId: string; requestedAt: string }
  | { kind: "ready"; jobId: string; readyAt: string; expiresAt: string; bytes: number | null }
  | { kind: "expired"; jobId: string; expiredAt: string }
  | { kind: "failed"; jobId: string; failedAt: string; reason: "too_large" | "other" };

export class ExportReadError extends Error {
  constructor(cause: { message: string; code?: string }) {
    super(`could not read exports: ${cause.code ?? "error"} ${cause.message}`);
    this.name = "ExportReadError";
  }
}

type Progress = { stage?: unknown; path?: unknown; bytes?: unknown };

function progressOf(row: ExportJobRow): Progress {
  return row.progress && typeof row.progress === "object" ? (row.progress as Progress) : {};
}

/** The archive's path in the exports bucket, only when it lies in this workspace's folder. */
export function archivePath(row: ExportJobRow, workspaceId: string): string | null {
  const path = progressOf(row).path;
  return typeof path === "string" && path.startsWith(`${workspaceId}/`) && !path.split("/").includes("..") ? path : null;
}

export function exportState(row: ExportJobRow | null, workspaceId: string, now: Date = new Date()): ExportState {
  if (!row) return { kind: "none" };
  if (row.status === "queued" || row.status === "running") {
    return { kind: "preparing", jobId: row.id, requestedAt: row.created_at };
  }
  if (row.status === "succeeded" && archivePath(row, workspaceId)) {
    const expiresAt = new Date(new Date(row.updated_at).getTime() + EXPORT_TTL_S * 1000);
    if (expiresAt <= now) return { kind: "expired", jobId: row.id, expiredAt: expiresAt.toISOString() };
    const bytes = progressOf(row).bytes;
    return {
      kind: "ready",
      jobId: row.id,
      readyAt: row.updated_at,
      expiresAt: expiresAt.toISOString(),
      bytes: typeof bytes === "number" ? bytes : null,
    };
  }
  // failed, cancelled, or succeeded without a usable path: never offered as a download
  // export_too_large comes from the worker's own message (ids and codes only, never customer text)
  const reason = row.last_error?.includes("export_too_large") ? "too_large" : "other";
  return { kind: "failed", jobId: row.id, failedAt: row.updated_at, reason };
}

export const EXPORT_COLUMNS = "id, status, progress, last_error, created_at, updated_at";

export async function readLatestExport(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<ExportJobRow | null> {
  const { data, error } = await supabase
    .schema("app")
    .from("jobs")
    .select(EXPORT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("kind", "export")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ExportReadError(error);
  return data;
}

/** "31 Oct 2026, 14:02" in UTC, so the server and the browser render the same text. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
