// Supplier portal (H03, S-NV2-028, T-802). A supplier without an account opens /supplier/<token> from the email and
// uploads the one document asked for, through the `supplier-upload` Edge Function only. The token goes to the
// function in a POST body, never in a URL the page builds; the page reads nothing else and keeps no session. An
// expired, used, unknown or malformed link reads the same: "This link is no longer open" (H03.fail.1).
import * as Sentry from "@sentry/nextjs";

/** What the worker mints (secrets.token_urlsafe(32)): 43 URL-safe characters. Anything else is unavailable at once. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_BYTES = 25 * 1024 * 1024;
export const ACCEPT = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export type OpenRequest = { workspaceName: string; supplierName: string | null; title: string; expiresAt: string };

export type DescribeOutcome = { kind: "open"; request: OpenRequest } | { kind: "unavailable" } | { kind: "error" };

export type UploadOutcome =
  | { kind: "received" }
  | { kind: "unavailable" }
  | { kind: "refused"; reason: "too_large" | "unsupported_type" | "no_file" }
  | { kind: "error" };

const TIMEOUT_MS = 5_000;

export function functionUrl(base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  return base ? `${base.replace(/\/$/, "")}/functions/v1/supplier-upload` : null;
}

/** Accepts the function's answer only in the shape it promises; anything else is not trusted. */
export function parseOpen(body: unknown): OpenRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.status !== "open" || typeof b.workspace_name !== "string" || typeof b.title !== "string" || typeof b.expires_at !== "string") {
    return null;
  }
  return {
    workspaceName: b.workspace_name,
    supplierName: typeof b.supplier_name === "string" ? b.supplier_name : null,
    title: b.title,
    expiresAt: b.expires_at,
  };
}

type Deps = { url?: string | null; anonKey?: string; fetchFn?: typeof fetch };

/** Server side: what the link asks for, or the generic unavailable answer. */
export async function describeRequest(
  token: string,
  { requestId, visitor }: { requestId: string | null; visitor: string },
  deps: Deps = {},
): Promise<DescribeOutcome> {
  const { url = functionUrl(), anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, fetchFn = fetch } = deps;
  if (!TOKEN_PATTERN.test(token)) return { kind: "unavailable" };
  if (!url || !anonKey) {
    Sentry.captureMessage("supplier portal: Supabase URL or anon key missing", { level: "error", tags: { request_id: requestId ?? "" } });
    return { kind: "error" };
  }
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        "x-forwarded-for": visitor,
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { request_id: requestId ?? "", fn: "supplier-upload" } });
    return { kind: "error" };
  }
  if (res.status === 404) return { kind: "unavailable" };
  const open = res.ok ? parseOpen(await res.json().catch(() => null)) : null;
  if (!open) {
    if (res.status !== 429) {
      Sentry.captureMessage(`supplier portal: unexpected answer from the function (${res.status})`, {
        level: "error",
        tags: { request_id: requestId ?? "", fn: "supplier-upload" },
      });
    }
    return { kind: "error" };
  }
  return { kind: "open", request: open };
}

/** The browser's own check before sending: the function checks again, by magic bytes. */
export function checkFile(file: { name: string; size: number; type: string }): "too_large" | "unsupported_type" | "no_file" | null {
  if (file.size === 0) return "no_file";
  if (file.size > MAX_BYTES) return "too_large";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ext in ACCEPT) || (file.type && file.type !== ACCEPT[ext as keyof typeof ACCEPT])) return "unsupported_type";
  return null;
}

/** Browser side: the multipart upload, straight to the function. */
export async function uploadDocument(token: string, file: File, deps: Deps = {}): Promise<UploadOutcome> {
  const { url = functionUrl(), anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, fetchFn = fetch } = deps;
  if (!TOKEN_PATTERN.test(token)) return { kind: "unavailable" };
  const problem = checkFile(file);
  if (problem) return { kind: "refused", reason: problem };
  if (!url || !anonKey) return { kind: "error" };
  const ext = file.name.split(".").pop()!.toLowerCase() as keyof typeof ACCEPT;
  const form = new FormData();
  form.set("token", token);
  // The declared type is set from the extension when the browser left it empty; the function checks the bytes.
  form.set("file", file.type ? file : new File([file], file.name, { type: ACCEPT[ext] }));
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, body: form });
  } catch {
    return { kind: "error" };
  }
  if (res.ok) return { kind: "received" };
  if (res.status === 404) return { kind: "unavailable" };
  if (res.status === 413) return { kind: "refused", reason: "too_large" };
  if (res.status === 415) return { kind: "refused", reason: "unsupported_type" };
  if (res.status === 400) return { kind: "refused", reason: "no_file" };
  return { kind: "error" };
}
