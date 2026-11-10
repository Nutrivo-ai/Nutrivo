// supplier-upload (T-802, H03, docs/04-contracts.md): a supplier without an account answers a document request through
// the link they were emailed. The token arrives only in the POST body (never in this function's URL), reaches exactly
// one request and is used up by the upload (H03.must.1). An expired, used, unknown or malformed token gets the same
// 404 {"error":"link_unavailable"} (H03.fail.1): nothing tells a caller which it was.
//
//   POST application/json {token}                  describe: {status:"open", workspace_name, supplier_name, title,
//                                                  expires_at} for an open request, the generic 404 otherwise
//   POST multipart/form-data {token, file}         upload: the token is checked first, then the declared MIME type
//                                                  AND the magic bytes (PDF, DOCX, XLSX), then the size (25 MiB);
//                                                  the file lands in the quarantine bucket at
//                                                  <workspace>/<request>/<file>, then app.accept_supplier_upload uses
//                                                  the link and queues the scan; 200 {status:"received"}
//
// It runs with the service role, so it calls only app.supplier_request_for_token and app.accept_supplier_upload (both
// service-role only) and the quarantine bucket. Logs carry the outcome and the request id, never the token, the file
// name or the workspace. Plain JavaScript with fetch only: the same file runs in Deno (index.ts) and under node:test
// (upload.test.mjs, run by worker/tests/test_supplier_upload_function.py).

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_BYTES = 25 * 1024 * 1024;
const FORM_OVERHEAD = 64 * 1024;
export const PER_CLIENT_PER_MINUTE = 30;
export const PER_INSTANCE_PER_MINUTE = 600;
const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

export const TYPES = Object.freeze({
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

export const UNAVAILABLE = Object.freeze({ error: "link_unavailable" });

function answer(status, body, cors, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...cors,
      ...extra,
    },
  });
}

function indexOf(bytes, needle, from = 0) {
  const first = needle[0];
  outer: for (let i = bytes.indexOf(first, from); i !== -1 && i <= bytes.length - needle.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const PDF = ascii("%PDF-");
const ZIP = Uint8Array.of(0x50, 0x4b, 0x03, 0x04);
const CONTENT_TYPES = ascii("[Content_Types].xml");
const WORD = ascii("word/document.xml");
const EXCEL = ascii("xl/workbook.xml");

/** What the bytes are, by their magic numbers and (for OOXML) their part names: "pdf", "docx", "xlsx" or null. */
export function sniff(bytes) {
  if (bytes.length >= PDF.length && PDF.every((b, i) => bytes[i] === b)) return "pdf";
  if (bytes.length >= ZIP.length && ZIP.every((b, i) => bytes[i] === b) && indexOf(bytes, CONTENT_TYPES) !== -1) {
    const word = indexOf(bytes, WORD) !== -1;
    const excel = indexOf(bytes, EXCEL) !== -1;
    if (word !== excel) return word ? "docx" : "xlsx";
  }
  return null;
}

/** A storage-safe file name with the extension the bytes earned: [A-Za-z0-9._-], at most 120 characters. */
export function safeName(name, kind) {
  const base = String(name ?? "").split(/[\\/]/).pop().replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 100);
  return `${base || "document"}.${kind}`;
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
    const used = clients.get(client) ?? 0;
    if (total >= perInstance || used >= perClient || (!clients.has(client) && clients.size >= MAX_TRACKED_CLIENTS)) {
      return { ok: false, retryAfter };
    }
    clients.set(client, used + 1);
    total += 1;
    return { ok: true, retryAfter: 0 };
  };
}

export function clientOf(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  return first || req.headers.get("x-real-ip") || "unknown";
}

export function makeHandler({ supabaseUrl, serviceKey, allowedOrigin = "*", fetchFn = fetch, now = () => Date.now(),
                              limiter = makeLimiter(), log = (line) => console.log(JSON.stringify(line)) }) {
  const base = (supabaseUrl ?? "").replace(/\/$/, "");
  const cors = {
    "Access-Control-Allow-Origin": allowedOrigin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-request-id",
    "Vary": "Origin",
  };
  const auth = () => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });

  async function rpc(name, args, requestId) {
    const res = await fetchFn(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json", "Content-Profile": "app",
                 ...(requestId ? { "x-request-id": requestId } : {}) },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw Object.assign(new Error("rpc failed"), { status: res.status });
    return res.json();
  }

  const objectUrl = (path) => `${base}/storage/v1/object/quarantine/${path.split("/").map(encodeURIComponent).join("/")}`;

  return async function handle(req) {
    const requestId = (req.headers.get("x-request-id") ?? "").slice(0, 64) || null;
    const done = (status, body, outcome, extra) => {
      log({ fn: "supplier-upload", outcome, request_id: requestId });
      return answer(status, body, cors, extra);
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return done(405, { error: "method_not_allowed" }, "method_not_allowed", { Allow: "POST, OPTIONS" });
    const gate = limiter(clientOf(req), now());
    if (!gate.ok) return done(429, { error: "rate_limited" }, "rate_limited", { "Retry-After": String(gate.retryAfter) });
    if (!base || !serviceKey) return done(503, { error: "unavailable" }, "misconfigured");

    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES + FORM_OVERHEAD) return done(413, { error: "too_large" }, "too_large");

    let token;
    let file = null;
    const upload = type.startsWith("multipart/form-data");
    try {
      if (upload) {
        const form = await req.formData();
        token = form.get("token");
        file = form.get("file");
      } else if (type.startsWith("application/json")) {
        token = (await req.json())?.token;
      } else {
        return done(415, { error: "unsupported_request" }, "unsupported_request");
      }
    } catch {
      return done(400, { error: "bad_request" }, "bad_request");
    }

    // H03.fail.1: the token first, and every way it can fail looks the same.
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return done(404, UNAVAILABLE, "unavailable");
    let open;
    try {
      open = await rpc("supplier_request_for_token", { p_token: token }, requestId);
    } catch {
      return done(503, { error: "unavailable" }, "db_error");
    }
    if (!open || open.status !== "open" || typeof open.request_id !== "string" || typeof open.workspace_id !== "string") {
      return done(404, UNAVAILABLE, "unavailable");
    }
    if (!upload) {
      return done(200, { status: "open", workspace_name: open.workspace_name ?? null, supplier_name: open.supplier_name ?? null,
                         title: open.title ?? null, expires_at: open.expires_at ?? null }, "described");
    }

    // H03 step 1: MIME type and magic bytes agree, and the size is within 25 MiB.
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") return done(400, { error: "no_file" }, "no_file");
    if (file.size > MAX_BYTES) return done(413, { error: "too_large" }, "too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return done(400, { error: "no_file" }, "no_file");
    if (bytes.length > MAX_BYTES) return done(413, { error: "too_large" }, "too_large");
    const kind = sniff(bytes);
    const declared = String(file.type ?? "").toLowerCase().split(";")[0].trim();
    if (kind === null || declared !== TYPES[kind]) return done(415, { error: "unsupported_type" }, "unsupported_type");

    const sha = await sha256Hex(bytes);
    const path = `${open.workspace_id}/${open.request_id}/${safeName(file.name, kind)}`;
    let stored;
    try {
      stored = await fetchFn(objectUrl(path), {
        method: "POST",
        headers: { ...auth(), "Content-Type": TYPES[kind], "x-upsert": "false", "Cache-Control": "no-store" },
        body: bytes,
      });
    } catch {
      return done(503, { error: "unavailable" }, "storage_unreachable");
    }
    if (stored.status === 409) return done(404, UNAVAILABLE, "unavailable");   // a concurrent upload to the same request
    if (!stored.ok) return done(503, { error: "unavailable" }, "storage_error");

    const remove = async () => {
      try {
        await fetchFn(objectUrl(path), { method: "DELETE", headers: auth() });
      } catch {
        log({ fn: "supplier-upload", outcome: "orphan_not_removed", request_id: requestId });
      }
    };
    let accepted;
    try {
      accepted = await rpc("accept_supplier_upload", { p_token: token, p_path: path, p_sha256: sha }, requestId);
    } catch {
      await remove();
      return done(503, { error: "unavailable" }, "db_error");
    }
    if (!accepted || accepted.status !== "accepted") {
      await remove();   // the link was used or expired between the check and the upload
      return done(404, UNAVAILABLE, "unavailable");
    }
    return done(200, { status: "received" }, "received");
  };
}
