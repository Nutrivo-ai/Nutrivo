// T-406 · the verify function under node:test (worker/tests/test_verify_function.py runs this file).
import assert from "node:assert/strict";
import test from "node:test";

import { PER_CLIENT_PER_MINUTE, UNKNOWN, makeHandler, makeLimiter, publicAnswer, referenceFrom } from "./verify.js";

const REF = "N7QK42P9MXR31ABCDEFGHJKLMQ";
const ANON = "anon-key-t406-not-a-secret";
const SERVICE = "service-role-key-must-never-be-sent";
const ISSUED = "2026-08-25T09:14:00+00:00";

function harness({ status = 200, body = { status: "current", issued_at: ISSUED, ruleset_version: "2026.08",
                                           has_not_assessed: true }, throws = false, limiter } = {}) {
  const calls = [];
  const lines = [];
  const handle = makeHandler({
    supabaseUrl: "http://db.local/", anonKey: ANON, now: () => 1_800_000_000_000, log: (l) => lines.push(l),
    ...(limiter ? { limiter } : {}),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (throws) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(body), { status });
    },
  });
  return { handle, calls, lines };
}

const get = (ref, init = {}) => new Request(`http://fn.local/functions/v1/verify/${ref}`, init);

async function snapshot(res) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()].sort() };
}

test("[I04.main] a current reference answers status, issue date, ruleset and not-assessed, through verify_reference only", async () => {
  const { handle, calls, lines } = harness();
  const res = await handle(get(REF, { headers: { "x-request-id": "req-1" } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "current", issued_at: ISSUED, ruleset_version: "2026.08",
                                       has_not_assessed: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://db.local/rest/v1/rpc/verify_reference");
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_ref: REF });
  assert.equal(calls[0].init.headers["x-request-id"], "req-1");
  assert.ok(!JSON.stringify(lines).includes(REF), "the reference is never logged");
  assert.deepEqual(lines, [{ fn: "verify", outcome: "current", request_id: "req-1" }]);
});

test("[I04.main] a superseded reference says so and still gives its issue date", async () => {
  const { handle } = harness({ body: { status: "superseded", issued_at: ISSUED, ruleset_version: "2026.08",
                                       has_not_assessed: false } });
  assert.deepEqual(await (await handle(get(REF))).json(),
                   { status: "superseded", issued_at: ISSUED, ruleset_version: "2026.08", has_not_assessed: false });
});

test("[I04.main] only the four BE-28 fields leave the function, whatever the database adds", () => {
  const extra = { status: "current", issued_at: ISSUED, ruleset_version: "2026.08", has_not_assessed: true,
                  workspace_id: "w", product: "Salmon & Rice", findings: [] };
  assert.deepEqual(Object.keys(publicAnswer(extra)).sort(), ["has_not_assessed", "issued_at", "ruleset_version", "status"]);
  assert.equal(publicAnswer({ status: "current" }), null, "a current answer without its facts is not passed on");
  assert.deepEqual(publicAnswer({ status: "revoked", workspace_id: "w" }), UNKNOWN);
});

test("[I04.must.1] the function presents the anon key, never a service key, and calls no table", async () => {
  const { handle, calls } = harness();
  await handle(get(REF));
  const headers = calls[0].init.headers;
  assert.equal(headers.apikey, ANON);
  assert.equal(headers.Authorization, `Bearer ${ANON}`);
  assert.ok(!JSON.stringify(calls).includes(SERVICE));
  assert.ok(!("Content-Profile" in headers) && !("Accept-Profile" in headers), "public schema only");
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/verify_reference$/);
});

test("[I04.must.2] the answer does not depend on the workspace: the function sends nothing but the reference", async () => {
  const { handle, calls } = harness();
  await handle(get(REF, { headers: { authorization: "Bearer some-user-session" } }));
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_ref: REF });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ANON}`, "a caller's own session is never forwarded");
});

test("[I04.fail.1] malformed, near-miss and missing references all get the identical unknown answer", async () => {
  const missing = harness({ body: { status: "unknown" } });
  const reference = await snapshot(await missing.handle(get(REF)));
  assert.equal(reference.status, 200);
  assert.deepEqual(JSON.parse(reference.body), { status: "unknown" });
  for (const probe of [REF.slice(0, -1) + "Z", REF.toLowerCase(), REF.slice(0, 20), REF + "A"]) {
    assert.deepEqual(await snapshot(await missing.handle(get(probe))), reference, probe);
  }
  const offline = harness({ throws: true });
  for (const probe of ["short", "x".repeat(65), "%E0%A4%A", "has%20space%20in%20it%20padding", "a/b", "", "..%2F..%2Fetc"]) {
    assert.deepEqual(await snapshot(await offline.handle(get(probe))), reference, `malformed: ${probe}`);
  }
  assert.equal(offline.calls.length, 0, "a malformed reference never reaches the database");
});

test("[I04.fail.1] the reference must be exactly one segment after the function name", () => {
  assert.equal(referenceFrom(`http://x/functions/v1/verify/${REF}`), REF);
  assert.equal(referenceFrom(`http://x/verify/${REF}`), REF);
  assert.equal(referenceFrom(`http://x/verify/${REF}/extra`), null);
  assert.equal(referenceFrom("http://x/verify"), null);
});

test("I04: only GET is answered", async () => {
  const { handle, calls } = harness();
  const res = await handle(get(REF, { method: "POST", body: "{}" }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET");
  assert.equal(calls.length, 0);
});

test("I04: a client past its limit is refused with Retry-After, and others still get through", async () => {
  const { handle, calls } = harness({ limiter: makeLimiter({ perClient: 2, perInstance: 100 }) });
  const from = (ip) => get(REF, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
  assert.equal((await handle(from("192.0.2.1"))).status, 200);
  assert.equal((await handle(from("192.0.2.1"))).status, 200);
  const refused = await handle(from("192.0.2.1"));
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) >= 1);
  assert.equal((await handle(from("192.0.2.2"))).status, 200);
  assert.equal(calls.length, 3, "a refused request never reaches the database");
});

test("I04: the limiter's windows reset, and the instance ceiling holds across clients", () => {
  const allow = makeLimiter({ perClient: PER_CLIENT_PER_MINUTE, perInstance: 3 });
  assert.ok(allow("a", 0).ok && allow("b", 1).ok && allow("c", 2).ok);
  assert.equal(allow("d", 3).ok, false);
  assert.ok(allow("d", 60_000).ok, "a new minute starts afresh");
});

test("I04: the database failing is unavailable, never unknown and never current", async () => {
  for (const h of [harness({ throws: true }), harness({ status: 500, body: { message: "boom" } }),
                   harness({ body: { status: "current" } })]) {
    const res = await h.handle(get(REF));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "unavailable" });
  }
  const misconfigured = makeHandler({ supabaseUrl: "", anonKey: "", log: () => {} });
  assert.equal((await misconfigured(get(REF))).status, 503);
});
