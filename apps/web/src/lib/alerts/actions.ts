"use server";

// T-902 · J04: the inbox's one write. "Mark all read" records the person's own read of the alerts the page showed them
// unread, through app.mark_alerts_read (T-901, BE-39): per person, at most 500 ids a call, every id readable by the
// caller or the whole call is refused. A failure goes to Sentry by its error code with the request id, never with ids.
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { MARK_READ_BATCH } from "./model";

export type MarkReadResult = { ok: true; marked: number } | { ok: false; reason: "no-permission" | "invalid" | "error" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most a single press sends: the inbox's read cap. */
const MAX_IDS = 10_000;

export async function markAlertsRead(workspaceId: string, alertIds: string[]): Promise<MarkReadResult> {
  if (!UUID.test(workspaceId) || !Array.isArray(alertIds) || alertIds.length > MAX_IDS || !alertIds.every((id) => typeof id === "string" && UUID.test(id))) {
    return { ok: false, reason: "invalid" };
  }
  const ids = [...new Set(alertIds)];
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  const db = await createClient();
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "alerts");
    scope.setTag("alerts_step", "mark_alerts_read");
    let marked = 0;
    for (let i = 0; i < ids.length; i += MARK_READ_BATCH) {
      const { data, error } = await db
        .schema("app")
        .rpc("mark_alerts_read", { p_alerts: ids.slice(i, i + MARK_READ_BATCH) })
        .setHeader(REQUEST_ID_HEADER, requestId);
      if (error) {
        const reason = error.code === "42501" ? "no-permission" : error.code === "22023" ? "invalid" : "error";
        if (reason === "error") Sentry.captureException(new Error(`mark_alerts_read failed: ${error.code ?? "error"}`));
        if (marked) revalidatePath(`/w/${workspaceId}/alerts`);
        return { ok: false, reason } as const;
      }
      marked += Number(data ?? 0);
    }
    revalidatePath(`/w/${workspaceId}/alerts`);
    return { ok: true, marked } as const;
  });
}
