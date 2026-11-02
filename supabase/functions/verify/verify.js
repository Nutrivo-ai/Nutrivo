// verify (T-406, I04, contract 8, BE-28): anyone holding a reference asks whether Nutrivo issued it. The function calls
// public.verify_reference and nothing else, with the anon key, so it can reach no table even by mistake: anon executes
// only verify_reference and coverage_snapshot and reads nothing (20261008000004_security.sql). The answer does not
// depend on the workspace's subscription, dunning or closure (BE-36, CLAUDE.md non-negotiable 9): verify_reference
// reads app.reports and app.supersessions only.
//
// Plain JavaScript with fetch only, so the same file runs in Supabase's Deno runtime (index.ts) and under node:test
// (verify.test.mjs, run by worker/tests/test_verify_function.py).
//
// GET /verify/{ref} answers 200 with exactly one of
//   {"status":"current"|"superseded","issued_at","ruleset_version","has_not_assessed"}
//   {"status":"unknown"}
// A malformed reference and one that does not exist get the same body, status and headers (I04.fail.1): nothing tells a
// caller how close a guess was. 405 for any other method · 429 with Retry-After past the rate limit · 503 when the
// database cannot answer. Logs carry the outcome and the request id only, never the reference.

export const REF_PATTERN = /^[A-Za-z0-9-]{20,64}$/;
export const PER_CLIENT_PER_MINUTE = 60;
export const PER_INSTANCE_PER_MINUTE = 1200;
const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

export const UNKNOWN = Object.freeze({ status: "unknown" });

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function answer(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

/** The reference is the path segment after the function's name: /verify/{ref} or /functions/v1/verify/{ref}. */
export function referenceFrom(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const at = parts.lastIndexOf("verify");
  if (at < 0 || parts.length !== at + 2) return null;
  let ref;
  try {
    ref = decodeURIComponent(parts[at + 1]).trim();
  } catch {
    return null;
  }
  return REF_PATTERN.test(ref) ? ref : null;
}

/** Only the four fields BE-28 allows, and only for the two states that have them; anything else is unknown. */
export function publicAnswer(result) {
  if (!result || typeof result !== "object") return UNKNOWN;
  if (result.status !== "current" && result.status !== "superseded") return UNKNOWN;
  if (typeof result.issued_at !== "string" || typeof result.ruleset_version !== "string"
      || typeof result.has_not_assessed !== "boolean") return null;
  return { status: result.status, issued_at: result.issued_at, ruleset_version: result.ruleset_version,
           has_not_assessed: result.has_not_assessed };
}

/**
 * Best-effort fixed windows, per client and per instance, held in this instance's memory (T-406 plan, question 2): it
 * slows a single guesser and bounds the database load one instance can cause; a shared limiter is T-1103's.
 */
export function makeLimiter({ perClient = PER_CLIENT_PER_MINUTE, perInstance = PER_INSTANCE_PER_MINUTE } = {}) {
  let windowStart = -Infinity;
  let total = 0;
  const clients = new Map();
  return function allow(client, nowMs) {
    if (nowMs - windowStart >= WINDOW_MS) {
      windowStart = nowMs;
      total = 0;
      clients.clear();
    }
    const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - nowMs) / 1000));
    if (total >= perInstance) return { ok: false, retryAfter };
    const used = clients.get(client) ?? 0;
    if (used >= perClient) return { ok: false, retryAfter };
    if (!clients.has(client) && clients.size >= MAX_TRACKED_CLIENTS) return { ok: false, retryAfter };
    clients.set(client, used + 1);
    total += 1;
    return { ok: true, retryAfter: 0 };
  };
}

/** The caller as the nearest proxy reports it. The web route forwards its visitor's address the same way. */
export function clientOf(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  return first || req.headers.get("x-real-ip") || "unknown";
}

export function makeHandler({ supabaseUrl, anonKey, fetchFn = fetch, now = () => Date.now(), limiter = makeLimiter(),
                              log = (line) => console.log(JSON.stringify(line)) }) {
  return async function handle(req) {
    const requestId = (req.headers.get("x-request-id") ?? "").slice(0, 64) || null;
    if (req.method !== "GET") return answer(405, { error: "method_not_allowed" }, { Allow: "GET" });
    const gate = limiter(clientOf(req), now());
    if (!gate.ok) {
      log({ fn: "verify", outcome: "rate_limited", request_id: requestId });
      return answer(429, { error: "rate_limited" }, { "Retry-After": String(gate.retryAfter) });
    }
    if (!supabaseUrl || !anonKey) {
      log({ fn: "verify", outcome: "misconfigured", request_id: requestId });
      return answer(503, { error: "unavailable" });
    }
    const ref = referenceFrom(req.url);
    if (ref === null) {
      log({ fn: "verify", outcome: "unknown", request_id: requestId });
      return answer(200, UNKNOWN);
    }
    let res;
    try {
      res = await fetchFn(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/verify_reference`, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json",
                   ...(requestId ? { "x-request-id": requestId } : {}) },
        body: JSON.stringify({ p_ref: ref }),
      });
    } catch (err) {
      log({ fn: "verify", outcome: "db_unreachable", error: err?.name ?? "Error", request_id: requestId });
      return answer(503, { error: "unavailable" });
    }
    if (!res.ok) {
      log({ fn: "verify", outcome: "db_error", status: res.status, request_id: requestId });
      return answer(503, { error: "unavailable" });
    }
    let body;
    try {
      body = publicAnswer(await res.json());
    } catch {
      body = null;
    }
    if (body === null) {
      log({ fn: "verify", outcome: "bad_shape", request_id: requestId });
      return answer(503, { error: "unavailable" });
    }
    log({ fn: "verify", outcome: body.status, request_id: requestId });
    return answer(200, body);
  };
}
