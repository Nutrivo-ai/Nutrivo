"use server";

// O03 (T-804): request a full export, and sign a link to a ready one. Both run under the person's session: the request
// goes through app.request_export (admin only, never gated by plan or billing, BE-44) and the link through Storage,
// whose exports policy lets only an admin read the workspace's folder. Nothing here uses the service role.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { EXPORT_COLUMNS, archivePath, exportState } from "@/lib/exports/exports";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; reason: "no-permission" | "not-ready" | "error" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestExport(workspaceId: string): Promise<ActionResult<string>> {
  if (!UUID.test(workspaceId)) return { ok: false, reason: "error" };
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("app")
      .rpc("request_export", { p_ws: workspaceId, p_request_id: requestId });
    if (error) {
      if (error.code === "42501") return { ok: false, reason: "no-permission" } as const;
      Sentry.captureException(new Error(`request_export failed: ${error.code ?? "error"}`));
      return { ok: false, reason: "error" } as const;
    }
    return { ok: true, value: String(data) } as const;
  });
}

export async function exportLink(workspaceId: string, jobId: string): Promise<ActionResult<string>> {
  if (!UUID.test(workspaceId) || !UUID.test(jobId)) return { ok: false, reason: "error" };
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .schema("app")
    .from("jobs")
    .select(EXPORT_COLUMNS)
    .eq("id", jobId)
    .eq("workspace_id", workspaceId)
    .eq("kind", "export")
    .maybeSingle();
  if (error) {
    Sentry.captureException(new Error(`export read failed: ${error.code ?? "error"}`));
    return { ok: false, reason: "error" };
  }
  const state = exportState(row, workspaceId);
  const path = row ? archivePath(row, workspaceId) : null;
  if (state.kind !== "ready" || !path) return { ok: false, reason: "not-ready" };
  // The link never outlives the export's seven days (docs/04).
  const remaining = Math.floor((Date.parse(state.expiresAt) - Date.now()) / 1000);
  const { data, error: signError } = await supabase.storage
    .from("exports")
    .createSignedUrl(path, Math.max(60, remaining), { download: `nutrivo-export-${jobId}.zip` });
  if (signError || !data) {
    // Also what a non-admin gets: the exports policy hides the object, so Storage cannot sign it.
    Sentry.captureException(new Error("export link could not be signed"));
    return { ok: false, reason: "error" };
  }
  return { ok: true, value: data.signedUrl };
}
