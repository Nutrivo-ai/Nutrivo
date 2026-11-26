// T-604 · the share function under node:test (worker/tests/test_share_function.py runs this file).
import assert from "node:assert/strict";
import test from "node:test";

import {
  PDF_LINK_SECONDS, PER_CLIENT_PER_MINUTE, PER_INSTANCE_PER_MINUTE, UNKNOWN, makeHandler, makeLimiter, shareAnswer,
  signedPath,
} from "./share.js";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const SERVICE = "service-role-key-t604-not-a-secret";
const REF = "N7QK42P9MXR31ABCDEFGHJKLMQ";
const PDF_PATH = "20000000-0000-4000-8000-00000000000a/40000000-0000-4000-8000-00000000000a/N7QK42P9MXR31ABCDEFGHJKLMQ.pdf";
const OPEN = Object.freeze({
  status: "open", share_id: "60000000-0000-4000-8000-000000000001", expires_at: "2026-12-25T09:14:00+00:00",
  workspace_name: "Halden Pet Nutrition", product_name: "Salmon & Rice Adult 12 kg", node_id: "EU-DE", node_name: "Germany", ref: REF,
  issued_at: "2026-08-25T14:08:00+00:00", ruleset_version: "2026.08", artwork_sha: "4f1c" + "0".repeat(56) + "9ab2",
  has_not_assessed: true, pdf_path: PDF_PATH,
});
const SIGNED = `/object/sign/reports/${PDF_PATH}?token=signed.jwt.value`;

function harness({ rpc = { status: 200, body: OPEN }, sign = { status: 200, body: { signedURL: SIGNED } }, throws = false,
                   limiter, serviceKey = SERVICE } = {}) {
  const calls = [];
  const lines = [];
  const reported = [];
  const handle = makeHandler({
    supabaseUrl: "http://db.local/", serviceKey, now: () => 1_800_000_000_000, log: (l) => lines.push(l),
    report: async (l) => reported.push(l),
    ...(limiter ? { limiter } : {}),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (throws) throw new TypeError("fetch failed");
      const r = url.includes("/storage/v1/") ? sign : rpc;
      return new Response(JSON.stringify(r.body), { status: r.status });
    },
  });
  return { handle, calls, lines, reported };
}

const post = (body, headers = {}) => new Request("http://fn.local/functions/v1/share", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

async function snapshot(res) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()].sort() };
}

const FACTS = {
  status: "open", ref: REF, issued_at: OPEN.issued_at, ruleset_version: "2026.08", artwork_sha: OPEN.artwork_sha,
  has_not_assessed: true, workspace_name: "Halden Pet Nutrition", product_name: "Salmon & Rice Adult 12 kg",
  node_id: "EU-DE", node_name: "Germany", expires_at: OPEN.expires_at, has_pdf: true,
};

test("[I02.main] a live token answers the report's face facts, through app.open_share only, with the service role", async () => {
  const { handle, calls, lines } = harness();
  const res = await handle(post({ token: TOKEN }, { "x-request-id": "req-1", "user-agent": "Mozilla/5.0 test" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), FACTS);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://db.local/rest/v1/rpc/open_share");
  assert.equal(calls[0].init.headers["Content-Profile"], "app");
  assert.equal(calls[0].init.headers.apikey, SERVICE);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_token: TOKEN, p_user_agent: "Mozilla/5.0 test" });
  assert.equal(calls[0].init.headers["x-request-id"], "req-1");
  assert.deepEqual(lines, [{ fn: "share", outcome: "open", request_id: "req-1" }]);
});

test("[I02.main] the answer never carries the stored PDF path, the share's id or anything the database adds", async () => {
  const { handle } = harness({ rpc: { status: 200, body: { ...OPEN, workspace_id: "w", findings: [], recipient: "x@y.z" } } });
  const text = await (await handle(post({ token: TOKEN }))).text();
  assert.deepEqual(JSON.parse(text), FACTS);
  for (const leak of [PDF_PATH, OPEN.share_id, "workspace_id", "findings", "x@y.z", SERVICE]) assert.ok(!text.includes(leak), leak);
  assert.deepEqual(shareAnswer({ status: "revoked", ref: REF }), UNKNOWN);
  assert.equal(shareAnswer({ status: "open", ref: REF }), null, "an open answer without its facts is not passed on");
});

test("[I02.main] Download PDF: a signed link to the stored PDF that lives 300 s, named after the reference", async () => {
  assert.equal(PDF_LINK_SECONDS, 300);
  const { handle, calls, lines } = harness();
  const res = await handle(post({ token: TOKEN, pdf: true }, { "x-request-id": "req-2" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ...FACTS, pdf_signed_path: `${SIGNED}&download=${REF}.pdf` });
  assert.equal(calls.length, 2, "open_share first (the token is checked and the access logged), then Storage");
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/open_share$/);
  assert.equal(calls[1].url, `http://db.local/storage/v1/object/sign/reports/${PDF_PATH}`);
  assert.deepEqual(JSON.parse(calls[1].init.body), { expiresIn: 300 });
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${SERVICE}`);
  assert.deepEqual(lines, [{ fn: "share", outcome: "pdf", request_id: "req-2" }]);
});

test("[I02.main] a report without a stored PDF answers its facts with no link, and Storage is not asked", async () => {
  const { handle, calls } = harness({ rpc: { status: 200, body: { ...OPEN, pdf_path: null } } });
  const body = await (await handle(post({ token: TOKEN, pdf: true }))).json();
  assert.deepEqual(body, { ...FACTS, has_pdf: false, pdf_signed_path: null });
  assert.equal(calls.length, 1);
});

test("[I02.must.1] revoked, expired, unknown and malformed tokens all get exactly the one unknown answer", async () => {
  // app.open_share answers {"status":"unknown"} for a revoked, expired or unknown token alike (90_shares.test.sql).
  const known = harness({ rpc: { status: 200, body: { status: "unknown" } } });
  const reference = await snapshot(await known.handle(post({ token: TOKEN })));
  assert.equal(reference.status, 200);
  assert.equal(reference.body, '{"status":"unknown"}');
  for (const probe of [{ token: TOKEN.slice(0, -1) + "Z" }, { token: TOKEN, pdf: true }]) {
    assert.deepEqual(await snapshot(await known.handle(post(probe))), reference, JSON.stringify(probe));
  }
  assert.equal(known.calls.filter((c) => c.url.includes("/storage/")).length, 0, "an unknown token never reaches Storage");

  const offline = harness({ throws: true });
  const malformed = [
    { token: TOKEN.slice(0, 42) }, { token: TOKEN + "A" }, { token: "has space".padEnd(43, "x") }, { token: "" },
    { token: 42 }, { token: null }, {}, { tokens: TOKEN }, [TOKEN], { token: TOKEN, pdf: "yes" },
    { token: `${TOKEN.slice(0, 40)}%2F` }, { token: "../../etc/passwd".padEnd(43, "a") },
  ];
  for (const probe of malformed) {
    assert.deepEqual(await snapshot(await offline.handle(post(probe))), reference, `malformed: ${JSON.stringify(probe)}`);
  }
  for (const raw of ["not json", "", "null", '"' + TOKEN + '"', JSON.stringify({ token: TOKEN, pad: "x".repeat(2000) })]) {
    assert.deepEqual(await snapshot(await offline.handle(post(raw))), reference, `body: ${raw.slice(0, 30)}`);
  }
  const notJson = new Request("http://fn.local/functions/v1/share", { method: "POST", headers: { "content-type": "text/plain" }, body: TOKEN });
  assert.deepEqual(await snapshot(await offline.handle(notJson)), reference, "a token outside a JSON body");
  assert.equal(offline.calls.length, 0, "a malformed request never reaches the database");
});

test("[I02.must.1] the token is never in a URL the function calls, never logged and never reported", async () => {
  const { handle, calls, lines } = harness();
  await handle(post({ token: TOKEN, pdf: true }, { "x-request-id": "req-3" }));
  const failing = harness({ rpc: { status: 500, body: { message: "boom" } } });
  await failing.handle(post({ token: TOKEN }));
  for (const c of calls) assert.ok(!c.url.includes(TOKEN), c.url);
  assert.ok(!JSON.stringify([lines, failing.lines, failing.reported]).includes(TOKEN));
});

test("[I02.must.1] the service role key never leaves the function: not in an answer, a log or a report", async () => {
  const outputs = [];
  for (const h of [harness(), harness({ rpc: { status: 200, body: { status: "unknown" } } }), harness({ throws: true }),
                   harness({ sign: { status: 500, body: { error: "x" } } })]) {
    const res = await h.handle(post({ token: TOKEN, pdf: true }));
    outputs.push(await res.text(), JSON.stringify([...res.headers.entries()]), JSON.stringify(h.lines), JSON.stringify(h.reported));
  }
  assert.ok(!outputs.join("\n").includes(SERVICE));
});

test("I02: only POST is answered, and a caller's own session is never forwarded", async () => {
  const { handle, calls } = harness();
  const res = await handle(new Request(`http://fn.local/functions/v1/share/${TOKEN}`));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
  assert.equal(calls.length, 0);
  await handle(post({ token: TOKEN }, { authorization: "Bearer some-user-session" }));
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE}`);
});

test("I02: a client past its limit is refused with Retry-After, and others still get through", async () => {
  assert.equal(PER_CLIENT_PER_MINUTE, 60);
  assert.equal(PER_INSTANCE_PER_MINUTE, 1200);
  const { handle, calls, lines } = harness({ limiter: makeLimiter({ perClient: 2, perInstance: 100 }) });
  const from = (ip) => post({ token: TOKEN }, { "x-forwarded-for": `${ip}, 10.0.0.1` });
  assert.equal((await handle(from("192.0.2.1"))).status, 200);
  assert.equal((await handle(from("192.0.2.1"))).status, 200);
  const refused = await handle(from("192.0.2.1"));
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) >= 1);
  assert.equal((await handle(from("192.0.2.2"))).status, 200);
  assert.equal(calls.length, 3, "a refused request never reaches the database");
  assert.equal(lines[2].outcome, "rate_limited");
});

test("I02: the limiter's windows reset, and the instance ceiling holds across clients", () => {
  const allow = makeLimiter({ perClient: PER_CLIENT_PER_MINUTE, perInstance: 3 });
  assert.ok(allow("a", 0).ok && allow("b", 1).ok && allow("c", 2).ok);
  assert.equal(allow("d", 3).ok, false);
  assert.ok(allow("d", 60_000).ok, "a new minute starts afresh");
});

test("I02: the database or Storage failing is unavailable, reported, and never unknown or open", async () => {
  for (const [h, outcome] of [[harness({ throws: true }), "db_unreachable"],
                              [harness({ rpc: { status: 500, body: { message: "boom" } } }), "db_error"],
                              [harness({ rpc: { status: 200, body: { status: "open" } } }), "bad_shape"],
                              [harness({ sign: { status: 404, body: { error: "not_found" } } }), "storage_error"],
                              [harness({ sign: { status: 200, body: { signedURL: "/object/sign/other/x?token=t" } } }), "storage_bad_shape"]]) {
    const res = await h.handle(post({ token: TOKEN, pdf: true }));
    assert.equal(res.status, 503, outcome);
    assert.deepEqual(await res.json(), { error: "unavailable" });
    assert.equal(h.reported.length, 1, outcome);
    assert.equal(h.reported[0].outcome, outcome);
  }
  const misconfigured = harness({ serviceKey: "" });
  assert.equal((await misconfigured.handle(post({ token: TOKEN }))).status, 503);
  assert.equal(misconfigured.calls.length, 0);
});

test("I02: the signed path must be one object of the reports bucket", () => {
  assert.equal(signedPath(SIGNED, REF), `${SIGNED}&download=${REF}.pdf`);
  assert.equal(signedPath(`/storage/v1${SIGNED}`, REF), `${SIGNED}&download=${REF}.pdf`);
  assert.equal(signedPath("/object/sign/reports/x.pdf", REF), null, "no token");
  assert.equal(signedPath("https://elsewhere/object/sign/reports/x?token=t", REF), null);
  assert.equal(signedPath(undefined, REF), null);
});
