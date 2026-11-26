// Shared report (I02, D-30, T-604). A recipient with no account opens /share/<token> and reads the shared report's face
// facts, downloads its PDF and is pointed to /verify for the reference. The page asks the `share` Edge Function, which
// holds the service role and calls app.open_share (logging the access); the web server never holds that key. The token
// goes to the function in a POST body, never in a URL the server builds. A revoked, expired, unknown or malformed link
// reads the same: the function answers exactly {"status":"unknown"} for all of them.
import * as Sentry from "@sentry/nextjs";
import { shortHash } from "@/lib/share/model";
import { makeLimiter } from "./verify";
import { FUNCTION_REGION } from "./region";

/** What app.create_share and the notify worker mint: 43 URL-safe characters. Anything else is unknown at once. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The PDF link's lifetime, set by the function (supabase/functions/share/share.js), as the editor's own download. */
export const PDF_LINK_SECONDS = 300;

export type SharedReport = {
  status: "open";
  ref: string;
  issued_at: string;
  ruleset_version: string;
  artwork_sha: string;
  has_not_assessed: boolean;
  workspace_name: string | null;
  product_name: string | null;
  node_id: string | null;
  /** The market's name ("Germany"); null for an older function or an unknown node. */
  node_name?: string | null;
  expires_at: string | null;
  has_pdf: boolean;
};
export type Shared = SharedReport | { status: "unknown" };

export type ShareOutcome =
  | { kind: "answer"; share: Shared }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "unavailable" };

export type PdfOutcome =
  | { kind: "link"; url: string }
  | { kind: "no_pdf" }
  | { kind: "unknown" }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "unavailable" };

const UNKNOWN: Shared = { status: "unknown" };
const TIMEOUT_MS = 5_000;
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Accepts the function's answer only in the shape it promises; anything else is not trusted as an answer. */
export function parseShare(body: unknown): Shared | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.status === "unknown") return UNKNOWN;
  if (b.status !== "open") return null;
  if (!str(b.ref) || !str(b.issued_at) || !str(b.ruleset_version) || !str(b.artwork_sha)
      || typeof b.has_not_assessed !== "boolean" || typeof b.has_pdf !== "boolean" || !strOrNull(b.workspace_name)
      || !strOrNull(b.product_name) || !strOrNull(b.node_id) || !strOrNull(b.expires_at)
      || (b.node_name !== undefined && !strOrNull(b.node_name))) return null;
  return {
    status: "open", ref: b.ref, issued_at: b.issued_at, ruleset_version: b.ruleset_version, artwork_sha: b.artwork_sha,
    has_not_assessed: b.has_not_assessed, workspace_name: b.workspace_name, product_name: b.product_name,
    node_id: b.node_id, node_name: (b.node_name as string | null | undefined) ?? null, expires_at: b.expires_at,
    has_pdf: b.has_pdf,
  };
}

/** The market as the rest of the app names it ("Germany"), its id when the name is not known. */
export function marketOf(s: SharedReport): string | null {
  return s.node_name ?? s.node_id;
}

/** The rows of the result card, in S-NV2-027's style: what the report states on its face, nothing more. */
export function sharedFacts(s: SharedReport): { k: string; v: string }[] {
  return [
    { k: "Reference", v: s.ref },
    { k: "Document type", v: "Report of Check · generated, attested by nobody" },
    { k: "Product", v: s.product_name ?? "—" },
    { k: "Shared by", v: s.workspace_name ?? "—" },
    { k: "Market", v: marketOf(s) ?? "—" },
    { k: "Issued", v: DAY.format(new Date(s.issued_at)) },
    { k: "Ruleset version", v: s.ruleset_version },
    { k: "Artwork hash", v: shortHash(s.artwork_sha) },
    { k: "Items not assessed", v: s.has_not_assessed ? "Yes — the report lists them by name" : "No" },
    { k: "Link expires", v: s.expires_at ? DAY.format(new Date(s.expires_at)) : "No expiry" },
  ];
}

/**
 * The browser URL of a signed PDF path the function returned ("/object/sign/reports/…?token=…&download=…"), on this
 * app's public Supabase URL: the function's own SUPABASE_URL can be an internal address (the local stack's).
 */
export function pdfUrl(signedPath: unknown, base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!str(signedPath) || !base || !signedPath.startsWith("/object/sign/reports/") || !signedPath.includes("?token=")) return null;
  return `${base.replace(/\/$/, "")}/storage/v1${signedPath}`;
}

/** Best-effort per visitor in this server's memory, like /verify (its own budget); the function limits again. */
export const PER_VISITOR_PER_MINUTE = 30;
const visitorLimit = makeLimiter(PER_VISITOR_PER_MINUTE);

type Deps = {
  url?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  limit?: ReturnType<typeof makeLimiter>;
};
type Caller = { requestId: string | null; visitor: string; userAgent?: string | null };

type Call = { kind: "body"; body: unknown } | { kind: "rate_limited"; retryAfter: number } | { kind: "unavailable" };

async function callFunction(token: string, pdf: boolean, { requestId, visitor, userAgent }: Caller, deps: Deps): Promise<Call> {
  const {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    fetchFn = fetch,
    now = Date.now,
    limit = visitorLimit,
  } = deps;
  const gate = limit(visitor, now());
  if (!gate.ok) return { kind: "rate_limited", retryAfter: gate.retryAfter };
  if (!TOKEN_PATTERN.test(token)) return { kind: "body", body: UNKNOWN };
  if (!url || !anonKey) {
    Sentry.captureMessage("share: Supabase URL or anon key missing", { level: "error", tags: { request_id: requestId ?? "" } });
    return { kind: "unavailable" };
  }
  let res: Response;
  try {
    res = await fetchFn(`${url.replace(/\/$/, "")}/functions/v1/share`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        "x-forwarded-for": visitor,
        // Frankfurt, next to the database (D-02, non-negotiable 10), as for verify.
        "x-region": FUNCTION_REGION,
        ...(userAgent ? { "user-agent": userAgent.slice(0, 256) } : {}),
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify(pdf ? { token, pdf: true } : { token }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { request_id: requestId ?? "", fn: "share" } });
    return { kind: "unavailable" };
  }
  if (res.status === 429) {
    return { kind: "rate_limited", retryAfter: Math.max(1, Number(res.headers.get("retry-after")) || 60) };
  }
  if (!res.ok) {
    Sentry.captureMessage(`share: unexpected answer from the function (${res.status})`, {
      level: "error",
      tags: { request_id: requestId ?? "", fn: "share" },
    });
    return { kind: "unavailable" };
  }
  return { kind: "body", body: await res.json().catch(() => null) };
}

function unexpected(requestId: string | null): { kind: "unavailable" } {
  Sentry.captureMessage("share: the function's answer was not in its shape", {
    level: "error",
    tags: { request_id: requestId ?? "", fn: "share" },
  });
  return { kind: "unavailable" };
}

/** Server side: the shared report's face facts, or the one unknown answer. */
export async function openSharedReport(token: string, caller: Caller, deps: Deps = {}): Promise<ShareOutcome> {
  const call = await callFunction(token, false, caller, deps);
  if (call.kind !== "body") return call;
  const share = parseShare(call.body);
  return share ? { kind: "answer", share } : unexpected(caller.requestId);
}

/** Server side: a fresh signed link to the shared report's PDF, valid for PDF_LINK_SECONDS. */
export async function sharedPdfLink(token: string, caller: Caller, deps: Deps = {}): Promise<PdfOutcome> {
  const call = await callFunction(token, true, caller, deps);
  if (call.kind !== "body") return call;
  const share = parseShare(call.body);
  if (!share) return unexpected(caller.requestId);
  if (share.status === "unknown") return { kind: "unknown" };
  const path = (call.body as { pdf_signed_path?: unknown }).pdf_signed_path;
  if (path === null || !share.has_pdf) return { kind: "no_pdf" };
  const link = pdfUrl(path, deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  return link ? { kind: "link", url: link } : unexpected(caller.requestId);
}
