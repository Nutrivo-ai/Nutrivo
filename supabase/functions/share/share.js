// share (T-604, I02, D-30, BE-27, docs/04-contracts.md): the recipient of a share link reads the shared report's face
// facts and downloads its PDF, with no account. Built like `verify`: one database call, best-effort rate limits per
// client and per instance, one identical unknown answer, logs with the outcome and request id only. Unlike `verify` it
// holds the service role, because app.open_share is executable by the service role only: the web server never holds
// that key (D-30). It calls app.open_share (which logs the access) and, for a download, signs the report's PDF in the
// `reports` bucket for PDF_LINK_SECONDS; nothing else.
//
// The token is the only credential and arrives only in the POST body, never in this function's URL (as
// supplier-upload), so no gateway or platform log holds it:
//
//   POST application/json {token}             200 {status:"open", ref, issued_at, ruleset_version, artwork_sha,
//                                             has_not_assessed, workspace_name, product_name, node_id, node_name,
//                                             expires_at, has_pdf} for a live share
//   POST application/json {token, pdf: true}  the same, plus pdf_signed_path: the signed object path under
//                                             /storage/v1 ("/object/sign/reports/…?token=…&download=<ref>.pdf"),
//                                             valid for 300 s, or null when the report has no stored PDF
//
// A revoked, expired, unknown or malformed token, and any body that is not {token}, get exactly 200
// {"status":"unknown"} with the same headers (I02, U09 "Revoked links: SHOW AS UNKNOWN"): nothing tells a caller which
// it was. The database's pdf_path, the share's id and the workspace's id never leave the function. 405 for any method
// but POST · 429 with Retry-After past the rate limit · 503 when the database or Storage cannot answer.
//
// Plain JavaScript with fetch only, so the same file runs in Supabase's Deno runtime (index.ts) and under node:test
// (share.test.mjs, run by worker/tests/test_share_function.py).

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PER_CLIENT_PER_MINUTE = 60;
export const PER_INSTANCE_PER_MINUTE = 1200;
/** The PDF link's lifetime: minutes for viewing (docs/09), the same as the editor's own download (actions.ts). */
export const PDF_LINK_SECONDS = 300;
export const MAX_BODY_BYTES = 1024;
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

const isString = (v) => typeof v === "string";
const isStringOrNull = (v) => v === null || typeof v === "string";

/**
 * Only the face facts leave the function, and only for a live share; any other status is unknown. An open answer
 * without its facts is not trusted (null: the caller answers unavailable, never open and never unknown).
 */
export function shareAnswer(result) {
  if (!result || typeof result !== "object" || result.status !== "open") return UNKNOWN;
  const r = result;
  if (!isString(r.ref) || !isString(r.issued_at) || !isString(r.ruleset_version) || !isString(r.artwork_sha)
      || typeof r.has_not_assessed !== "boolean" || !isStringOrNull(r.workspace_name ?? null)
      || !isStringOrNull(r.product_name ?? null) || !isStringOrNull(r.node_id ?? null) || !isStringOrNull(r.node_name ?? null)
      || !isStringOrNull(r.expires_at ?? null) || !isStringOrNull(r.pdf_path ?? null)) return null;
  return {
    status: "open",
    ref: r.ref,
    issued_at: r.issued_at,
    ruleset_version: r.ruleset_version,
    artwork_sha: r.artwork_sha,
    has_not_assessed: r.has_not_assessed,
    workspace_name: r.workspace_name ?? null,
    product_name: r.product_name ?? null,
    node_id: r.node_id ?? null,
    node_name: r.node_name ?? null,
    expires_at: r.expires_at ?? null,
    has_pdf: !!r.pdf_path,
  };
}

/** {token, pdf?} from the body, or null for anything else (which answers unknown, like a bad token). */
export async function readRequest(req) {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) return null;
  let text;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) return null;
  if (body.pdf !== undefined && typeof body.pdf !== "boolean") return null;
  return { token: body.token, pdf: body.pdf === true };
}

/** Best-effort fixed windows, per client and per instance, in this instance's memory: `verify`'s limiter. */
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

/** The caller as the nearest proxy reports it. The web page forwards its visitor's address the same way. */
export function clientOf(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  return first || req.headers.get("x-real-ip") || "unknown";
}

/** The signed object path Storage returns, checked to be one object of the reports bucket, with the download name. */
export function signedPath(signedURL, ref) {
  if (typeof signedURL !== "string") return null;
  const path = signedURL.startsWith("/storage/v1/") ? signedURL.slice("/storage/v1".length) : signedURL;
  if (!path.startsWith("/object/sign/reports/") || !path.includes("?token=")) return null;
  return `${path}&download=${encodeURIComponent(`${ref}.pdf`)}`;
}

export function makeHandler({ supabaseUrl, serviceKey, fetchFn = fetch, now = () => Date.now(), limiter = makeLimiter(),
                              log = (line) => console.log(JSON.stringify(line)), report = async () => {} }) {
  const base = (supabaseUrl ?? "").replace(/\/$/, "");
  const auth = () => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });

  return async function handle(req) {
    const requestId = (req.headers.get("x-request-id") ?? "").slice(0, 64) || null;
    const done = (status, body, outcome, extra) => {
      log({ fn: "share", outcome, request_id: requestId });
      return answer(status, body, extra);
    };
    const fail = async (outcome, extra = {}) => {
      const line = { fn: "share", outcome, ...extra, request_id: requestId };
      log(line);
      try {
        await report(line);
      } catch {
        // Reporting never changes the answer.
      }
      return answer(503, { error: "unavailable" });
    };

    if (req.method !== "POST") return done(405, { error: "method_not_allowed" }, "method_not_allowed", { Allow: "POST" });
    const gate = limiter(clientOf(req), now());
    if (!gate.ok) return done(429, { error: "rate_limited" }, "rate_limited", { "Retry-After": String(gate.retryAfter) });
    if (!base || !serviceKey) return fail("misconfigured");

    const asked = await readRequest(req);
    if (asked === null) return done(200, UNKNOWN, "unknown");

    let res;
    try {
      res = await fetchFn(`${base}/rest/v1/rpc/open_share`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json", "Content-Profile": "app",
                   ...(requestId ? { "x-request-id": requestId } : {}) },
        body: JSON.stringify({ p_token: asked.token, p_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 256) || null }),
      });
    } catch (err) {
      return fail("db_unreachable", { error: err?.name ?? "Error" });
    }
    if (!res.ok) return fail("db_error", { status: res.status });
    let raw;
    try {
      raw = await res.json();
    } catch {
      raw = undefined;
    }
    const body = shareAnswer(raw);
    if (body === null) return fail("bad_shape");
    if (body.status !== "open") return done(200, UNKNOWN, "unknown");
    if (!asked.pdf) return done(200, body, "open");

    // A download: sign the stored PDF for PDF_LINK_SECONDS. No stored PDF is a fact of the report, not a failure.
    if (!raw.pdf_path) return done(200, { ...body, pdf_signed_path: null }, "pdf_missing");
    const object = String(raw.pdf_path).split("/").map(encodeURIComponent).join("/");
    let signed;
    try {
      signed = await fetchFn(`${base}/storage/v1/object/sign/reports/${object}`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}) },
        body: JSON.stringify({ expiresIn: PDF_LINK_SECONDS }),
      });
    } catch (err) {
      return fail("storage_unreachable", { error: err?.name ?? "Error" });
    }
    if (!signed.ok) return fail("storage_error", { status: signed.status });
    let path;
    try {
      path = signedPath((await signed.json())?.signedURL, body.ref);
    } catch {
      path = null;
    }
    if (path === null) return fail("storage_bad_shape");
    return done(200, { ...body, pdf_signed_path: path }, "pdf");
  };
}
