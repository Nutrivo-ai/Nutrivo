// stripe-webhook (T-702, M04, docs/08 §Webhooks): verify Stripe's signature, then hand the event to
// app.record_stripe_event, which stores it once by event id (app.payment_events, insert-only) and queues an ids-only
// billing_sync job for the worker. Nothing is applied here: the worker re-reads the subscription from Stripe.
//
// Plain JavaScript with Web Crypto and fetch only, so the same file runs in Supabase's Deno runtime (index.ts) and
// under node:test (webhook.test.mjs, run by worker/tests/test_stripe_webhook_function.py).
//
// Answers: 405 not POST · 413 too large · 400 unsigned, badly signed, stale or not an event (Stripe does not retry
// these, and nothing is stored) · 200 stored or already stored · 500 misconfigured or the database failed (Stripe
// retries with backoff for three days, and the worker's daily reconciliation repairs anything it gives up on).
// Logs carry ids and outcomes only, never the payload or the secret.

export const TOLERANCE_S = 300;
export const MAX_BYTES = 1024 * 1024;

const encoder = new TextEncoder();

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function equalConstantTime(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Stripe's scheme: `Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.payload">[,v1=...]`. */
export async function verifySignature(payload, header, secret, nowS) {
  if (!header || !secret) return false;
  let t = null;
  const v1 = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || v1.length === 0 || Math.abs(nowS - t) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false,
    ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${payload}`)));
  return v1.some((s) => equalConstantTime(s, expected));
}

function answer(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function makeHandler({ secret, supabaseUrl, serviceKey, fetchFn = fetch, now = () => Date.now(),
                              log = (line) => console.log(JSON.stringify(line)) }) {
  return async function handle(req) {
    if (req.method !== "POST") return answer(405, { error: "method_not_allowed" });
    if (!secret || !supabaseUrl || !serviceKey) {
      log({ fn: "stripe-webhook", outcome: "misconfigured" });
      return answer(500, { error: "misconfigured" });
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return answer(413, { error: "too_large" });
    const payload = await req.text();
    if (encoder.encode(payload).length > MAX_BYTES) return answer(413, { error: "too_large" });
    if (!(await verifySignature(payload, req.headers.get("stripe-signature"), secret, Math.floor(now() / 1000)))) {
      log({ fn: "stripe-webhook", outcome: "bad_signature" });
      return answer(400, { error: "bad_signature" });
    }
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      event = null;
    }
    if (!event || typeof event.id !== "string" || typeof event.type !== "string" || event.object !== "event") {
      log({ fn: "stripe-webhook", outcome: "not_an_event" });
      return answer(400, { error: "not_an_event" });
    }
    let res;
    try {
      res = await fetchFn(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/record_stripe_event`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json",
                   "Content-Profile": "app" },
        body: JSON.stringify({ p_event: event }),
      });
    } catch (err) {
      log({ fn: "stripe-webhook", stripe_event_id: event.id, type: event.type, outcome: "db_unreachable",
            error: err?.name ?? "Error" });
      return answer(500, { error: "unavailable" });
    }
    if (!res.ok) {
      log({ fn: "stripe-webhook", stripe_event_id: event.id, type: event.type, outcome: "db_error", status: res.status });
      return answer(500, { error: "unavailable" });
    }
    const result = await res.json();
    log({ fn: "stripe-webhook", stripe_event_id: event.id, type: event.type,
          outcome: result?.duplicate ? "duplicate" : "stored", job_id: result?.job_id ?? null });
    return answer(200, { received: true });
  };
}
