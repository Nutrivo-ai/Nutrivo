// Public verification (I04, S-NV2-027, contract 8). The page asks the `verify` Edge Function, which calls
// public.verify_reference and nothing else, and shows only what that answers: current, superseded or unknown, with the
// issue date, the ruleset version and whether Not assessed items existed. Never the workspace, the product, the label
// or the findings. The answer does not depend on the workspace's subscription or closure (BE-36).
import * as Sentry from "@sentry/nextjs";

/** The same shape the function accepts (supabase/functions/verify/verify.js); anything else is unknown at once. */
export const REF_PATTERN = /^[A-Za-z0-9-]{20,64}$/;

export type Verification =
  | { status: "current" | "superseded"; issued_at: string; ruleset_version: string; has_not_assessed: boolean }
  | { status: "unknown" };

export type VerifyOutcome =
  | { kind: "answer"; verification: Verification }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "unavailable" };

/** The design prints the issue date in full ("25 August 2026"), in UTC so every reader sees the same day. */
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const UNKNOWN: Verification = { status: "unknown" };
const TIMEOUT_MS = 5_000;

/** A reference as typed or pasted: surrounding whitespace dropped, nothing else changed (exact match, I04.fail.1). */
export function normaliseRef(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

/** Accepts the function's answer only in the shape BE-28 allows; anything else is not trusted as an answer. */
export function parseVerification(body: unknown): Verification | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.status === "unknown") return UNKNOWN;
  if ((b.status === "current" || b.status === "superseded") && typeof b.issued_at === "string"
      && typeof b.ruleset_version === "string" && typeof b.has_not_assessed === "boolean") {
    return { status: b.status, issued_at: b.issued_at, ruleset_version: b.ruleset_version,
             has_not_assessed: b.has_not_assessed };
  }
  return null;
}

/** The rows of the result card, in the design's order (S-NV2-027). */
export function verificationFacts(ref: string, v: Verification): { k: string; v: string }[] {
  if (v.status === "unknown") return [{ k: "Reference", v: ref }];
  return [
    { k: "Reference", v: ref },
    // verify_reference reads app.reports only, so every answer it gives is about a Report of Check (plan on #48, Q3).
    { k: "Document type", v: "Report of Check · generated, attested by nobody" },
    { k: "Issued", v: DAY.format(new Date(v.issued_at)) },
    { k: "Ruleset version", v: v.ruleset_version },
    { k: "Items not assessed", v: v.has_not_assessed ? "Yes — the report lists them by name" : "No" },
  ];
}

/**
 * Best-effort fixed window per visitor, in this server instance's memory (plan on #48, Q2). The function limits again
 * per client and per instance; a shared limiter is T-1103's.
 */
export function makeLimiter(perMinute: number, maxClients = 10_000) {
  let windowStart = -Infinity;
  const used = new Map<string, number>();
  return (client: string, nowMs: number): { ok: boolean; retryAfter: number } => {
    if (nowMs - windowStart >= 60_000) {
      windowStart = nowMs;
      used.clear();
    }
    const retryAfter = Math.max(1, Math.ceil((windowStart + 60_000 - nowMs) / 1000));
    const n = used.get(client) ?? 0;
    if (n >= perMinute || (n === 0 && used.size >= maxClients)) return { ok: false, retryAfter };
    used.set(client, n + 1);
    return { ok: true, retryAfter: 0 };
  };
}

export const PER_VISITOR_PER_MINUTE = 30;
const visitorLimit = makeLimiter(PER_VISITOR_PER_MINUTE);

/** The visitor as the nearest proxy reports it; forwarded to the function so its own limit is per visitor too. */
export function visitorOf(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

type Deps = {
  url?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  limit?: ReturnType<typeof makeLimiter>;
};

export async function verifyReference(
  ref: string,
  { requestId, visitor }: { requestId: string | null; visitor: string },
  deps: Deps = {},
): Promise<VerifyOutcome> {
  const {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    fetchFn = fetch,
    now = Date.now,
    limit = visitorLimit,
  } = deps;
  const gate = limit(visitor, now());
  if (!gate.ok) return { kind: "rate_limited", retryAfter: gate.retryAfter };
  if (!REF_PATTERN.test(ref)) return { kind: "answer", verification: UNKNOWN };
  if (!url || !anonKey) {
    Sentry.captureMessage("verify: Supabase URL or anon key missing", { level: "error", tags: { request_id: requestId ?? "" } });
    return { kind: "unavailable" };
  }
  let res: Response;
  try {
    res = await fetchFn(`${url.replace(/\/$/, "")}/functions/v1/verify/${encodeURIComponent(ref)}`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "x-forwarded-for": visitor,
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { request_id: requestId ?? "", fn: "verify" } });
    return { kind: "unavailable" };
  }
  if (res.status === 429) {
    return { kind: "rate_limited", retryAfter: Math.max(1, Number(res.headers.get("retry-after")) || 60) };
  }
  const verification = res.ok ? parseVerification(await res.json().catch(() => null)) : null;
  if (!verification) {
    Sentry.captureMessage(`verify: unexpected answer from the function (${res.status})`, {
      level: "error",
      tags: { request_id: requestId ?? "", fn: "verify" },
    });
    return { kind: "unavailable" };
  }
  return { kind: "answer", verification };
}
