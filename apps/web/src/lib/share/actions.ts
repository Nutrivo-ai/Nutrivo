"use server";

// I02 (T-601): share a report by link or email, revoke a share, and download the report's PDF. Everything runs under
// the person's own session: writes through app.create_share and app.revoke_share, the PDF through Storage, whose reports
// policy lets members read their workspace's folder. Nothing here uses the service role. A link's token comes back once
// from create_share and goes straight to the person's browser; it is never logged, stored or sent to Sentry.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { EXPIRY_CHOICES } from "./model";

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

/** A link share: returns the token once, for the browser to show and copy. */
export async function createLinkShare(
  reportId: string,
  expiresInDays: number | null,
): Promise<ShareResult<{ shareId: string; token: string }>> {
  if (!UUID.test(reportId) || !EXPIRY_CHOICES.some((c) => c.days === expiresInDays)) return { ok: false, reason: "invalid" };
  return withRequest("share.create_link", async (requestId) => {
    const db = await createClient();
    const { data, error } = await db.schema("app").rpc("create_share", {
      p_report: reportId,
      p_channel: "link",
      // A null expiry means none; the generated types cannot say an argument is nullable.
      p_expires_in_days: expiresInDays as number,
      p_request_id: requestId,
    });
    if (error) return refusal("create_share", error);
    const out = data as { share_id?: string; token?: string } | null;
    if (!out?.share_id || !out.token) {
      Sentry.captureException(new Error("create_share returned no token for a link"));
      return { ok: false, reason: "error" } as const;
    }
    return { ok: true, value: { shareId: out.share_id, token: out.token } } as const;
  });
}

/** An email share: the notify job (Template 01) mints and emails the token; nothing comes back here. */
export async function createEmailShare(
  reportId: string,
  recipient: string,
  expiresInDays: number | null,
): Promise<ShareResult<{ shareId: string }>> {
  if (!UUID.test(reportId) || typeof recipient !== "string" || recipient.length > 254) return { ok: false, reason: "invalid" };
  if (!EXPIRY_CHOICES.some((c) => c.days === expiresInDays)) return { ok: false, reason: "invalid" };
  return withRequest("share.create_email", async (requestId) => {
    const db = await createClient();
    const { data, error } = await db.schema("app").rpc("create_share", {
      p_report: reportId,
      p_channel: "email",
      p_recipient: recipient,
      p_expires_in_days: expiresInDays as number,
      p_request_id: requestId,
    });
    if (error) return refusal("create_share", error);
    const out = data as { share_id?: string } | null;
    return { ok: true, value: { shareId: String(out?.share_id ?? "") } } as const;
  });
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
