"use server";

// I02 (T-601): revoke a share and download the report's PDF, under the person's own session: the revoke through
// app.revoke_share, the PDF through Storage, whose reports policy lets members read their workspace's folder. Nothing
// here uses the service role. Creating a share (app.create_share) is not offered on the screen until the recipient page
// exists (#58 Q1, follow-up issue).
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";

export type ShareRefusal = "no-permission" | "invalid" | "not-available" | "error";
export type ShareResult<T> = { ok: true; value: T } | { ok: false; reason: ShareRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODES: Record<string, ShareRefusal> = { "42501": "no-permission", "22023": "invalid" };
const PDF_LINK_SECONDS = 300;

async function withRequest<T>(area: string, fn: (requestId: string) => Promise<T>): Promise<T> {
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", area);
    return Sentry.startSpan({ name: area, op: "function.server_action" }, () => fn(requestId));
  });
}

function refusal(what: string, error: { code?: string }): { ok: false; reason: ShareRefusal } {
  const reason = (error.code && CODES[error.code]) || "error";
  if (reason === "error") Sentry.captureException(new Error(`${what} failed: ${error.code ?? "error"}`));
  return { ok: false, reason };
}

export async function revokeShare(shareId: string): Promise<ShareResult<string>> {
  if (!UUID.test(shareId)) return { ok: false, reason: "invalid" };
  return withRequest("share.revoke", async () => {
    const db = await createClient();
    const { data, error } = await db.schema("app").rpc("revoke_share", { p_share: shareId });
    if (error) return refusal("revoke_share", error);
    return { ok: true, value: String(data) } as const;
  });
}

/** A signed link to the report's stored PDF, for a few minutes, under the person's own session. */
export async function reportPdfLink(workspaceId: string, reportId: string): Promise<ShareResult<string>> {
  if (!UUID.test(workspaceId) || !UUID.test(reportId)) return { ok: false, reason: "invalid" };
  return withRequest("report.download", async () => {
    const db = await createClient();
    const { data: row, error } = await db
      .schema("app")
      .from("reports")
      .select("ref, pdf_path")
      .eq("id", reportId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return refusal("report read", error);
    if (!row?.pdf_path) return { ok: false, reason: "not-available" } as const;
    const { data, error: signError } = await db.storage
      .from("reports")
      .createSignedUrl(row.pdf_path, PDF_LINK_SECONDS, { download: `${row.ref}.pdf` });
    if (signError || !data) {
      Sentry.captureException(new Error("report PDF link could not be signed"));
      return { ok: false, reason: "not-available" } as const;
    }
    return { ok: true, value: data.signedUrl } as const;
  });
}
