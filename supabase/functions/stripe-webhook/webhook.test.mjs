// T-702 · the stripe-webhook function under node:test (worker/tests/test_stripe_webhook_function.py runs this file).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { MAX_BYTES, TOLERANCE_S, makeHandler, verifySignature } from "./webhook.js";

const SECRET = "whsec_test_t702_not_a_real_secret";
const NOW_S = 1_800_000_000;

function sign(payload, t = NOW_S, secret = SECRET) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

const EVENT = JSON.stringify({ id: "evt_t702_1", object: "event", type: "invoice.paid",
                               data: { object: { object: "invoice", customer: "cus_A", subscription: "sub_A1" } } });

function harness({ status = 200, body = { stored: true, duplicate: false, job_id: "j1" }, throws = false } = {}) {
  const calls = [];
  const lines = [];
  const handle = makeHandler({
    secret: SECRET, supabaseUrl: "http://db.local/", serviceKey: "service-role-key",
    now: () => NOW_S * 1000, log: (l) => lines.push(l),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (throws) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(body), { status });
    },
  });
  return { handle, calls, lines };
}

const post = (payload, signature) => new Request("http://fn.local/stripe-webhook", {
  method: "POST", body: payload, headers: signature ? { "stripe-signature": signature } : {} });

test("[M04.main] a correctly signed event is passed to app.record_stripe_event and acknowledged", async () => {
  const { handle, calls, lines } = harness();
  const res = await handle(post(EVENT, sign(EVENT)));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://db.local/rest/v1/rpc/record_stripe_event");
  assert.equal(calls[0].init.headers["Content-Profile"], "app");
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_event: JSON.parse(EVENT) });
  assert.deepEqual(lines, [{ fn: "stripe-webhook", stripe_event_id: "evt_t702_1", type: "invoice.paid",
                             outcome: "stored", job_id: "j1" }]);
});

test("[M04.main] a redelivered event is acknowledged again so Stripe stops retrying", async () => {
  const { handle, lines } = harness({ body: { stored: false, duplicate: true } });
  assert.equal((await handle(post(EVENT, sign(EVENT)))).status, 200);
  assert.equal(lines[0].outcome, "duplicate");
});

test("[T-702] unsigned, wrongly signed, tampered and stale requests are refused and nothing is stored", async () => {
  const { handle, calls } = harness();
  const tampered = EVENT.replace("invoice.paid", "invoice.payment_failed");
  for (const [payload, sig] of [
    [EVENT, null],
    [EVENT, sign(EVENT, NOW_S, "whsec_someone_else")],
    [tampered, sign(EVENT)],
    [EVENT, sign(EVENT, NOW_S - TOLERANCE_S - 1)],
    [EVENT, "t=abc,v1=xyz"],
  ]) {
    assert.equal((await handle(post(payload, sig))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("[T-702] one matching v1 among several (a rolled secret) is enough", async () => {
  const { handle } = harness();
  const other = createHmac("sha256", "whsec_old").update(`${NOW_S}.${EVENT}`).digest("hex");
  assert.equal((await handle(post(EVENT, `${sign(EVENT)},v1=${other}`))).status, 200);
  assert.equal(await verifySignature(EVENT, `t=${NOW_S},v1=${other}`, SECRET, NOW_S), false);
});

test("[T-702] a signed body that is not a Stripe event is refused", async () => {
  const { handle, calls } = harness();
  const body = JSON.stringify({ hello: "world" });
  assert.equal((await handle(post(body, sign(body)))).status, 400);
  assert.equal(calls.length, 0);
});

test("[T-702] a database failure answers 500 so Stripe retries, and the log holds ids only", async () => {
  for (const opts of [{ status: 503 }, { throws: true }]) {
    const { handle, lines } = harness(opts);
    assert.equal((await handle(post(EVENT, sign(EVENT)))).status, 500);
    assert.ok(!JSON.stringify(lines).includes("cus_A") && !JSON.stringify(lines).includes(SECRET));
  }
});

test("[T-702] not POST, too large or misconfigured", async () => {
  const { handle } = harness();
  assert.equal((await handle(new Request("http://fn.local/stripe-webhook"))).status, 405);
  const big = "x".repeat(MAX_BYTES + 1);
  assert.equal((await handle(post(big, sign(big)))).status, 413);
  const bare = makeHandler({ secret: "", supabaseUrl: "http://db.local", serviceKey: "k", log: () => {} });
  assert.equal((await bare(post(EVENT, sign(EVENT)))).status, 500);
});
