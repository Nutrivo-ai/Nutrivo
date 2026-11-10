// T-802 · the supplier-upload function under node:test (worker/tests/test_supplier_upload_function.py runs this file).
// The database and Storage are a fake that keeps one request's state the way app.supplier_request_for_token and
// app.accept_supplier_upload do (their own behaviour is tested in supabase/tests/app/97_supplier_links.test.sql).
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_BYTES, TYPES, UNAVAILABLE, makeHandler, makeLimiter, safeName, sniff } from "./upload.js";

const TOKEN = "A".repeat(20) + "b-_".repeat(7) + "Z".repeat(2);   // 43 URL-safe characters
const OTHER = "Q".repeat(43);
const SERVICE = "service-role-key-t802-not-a-secret";
const WS = "20000000-0000-4000-8802-00000000000a";
const REQ = "60000000-0000-4000-8802-00000000000a";

const enc = (s) => new TextEncoder().encode(s);
const PDF_BYTES = enc("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const zip = (...parts) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc(`${parts.join(" ")} [Content_Types].xml`)]);
const DOCX_BYTES = zip("word/document.xml");
const XLSX_BYTES = zip("xl/workbook.xml");

function backend({ state = "open", acceptAs = null, rpcStatus = 200, acceptThrows = false } = {}) {
  const calls = [];
  const lines = [];
  const objects = new Map();
  let used = state !== "open";
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.pathname === "/rest/v1/rpc/supplier_request_for_token") {
      if (rpcStatus !== 200) return new Response("{}", { status: rpcStatus });
      const { p_token } = JSON.parse(init.body);
      const open = p_token === TOKEN && !used;
      return Response.json(open ? { status: "open", request_id: REQ, workspace_id: WS, workspace_name: "Kruuse Pet Nutrition",
                                    supplier_name: "Aldrich Nutrition", title: "Premix specification",
                                    expires_at: "2026-11-24T09:00:00+00:00" } : { status: "unknown" });
    }
    if (u.pathname === "/rest/v1/rpc/accept_supplier_upload") {
      if (acceptThrows) { used = true; throw new TypeError("connection reset after commit"); }
      const { p_token } = JSON.parse(init.body);
      const ok = acceptAs === null ? p_token === TOKEN && !used : acceptAs;
      if (ok) used = true;
      return Response.json(ok ? { status: "accepted", document_id: "doc-1" } : { status: "unknown" });
    }
    if (u.pathname.startsWith("/storage/v1/object/quarantine/")) {
      const key = decodeURIComponent(u.pathname.slice("/storage/v1/object/quarantine/".length));
      if (init.method === "DELETE") {
        objects.delete(key);
        return new Response("{}", { status: 200 });
      }
      if (objects.has(key)) return new Response("{}", { status: 409 });
      objects.set(key, init.body);
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  const handle = makeHandler({ supabaseUrl: "http://db.local/", serviceKey: SERVICE, allowedOrigin: "https://app.test",
                               fetchFn, now: () => 1_800_000_000_000, log: (l) => lines.push(l) });
  return { handle, calls, lines, objects, use: () => { used = true; } };
}

const describe = (token, headers = {}) => new Request("http://fn.local/functions/v1/supplier-upload", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ token }),
});
function upload(token, bytes = PDF_BYTES, { type = TYPES.pdf, name = "Premix spec (2026).pdf" } = {}) {
  const form = new FormData();
  if (token !== undefined) form.set("token", token);
  if (bytes !== null) form.set("file", new File([bytes], name, { type }));
  return new Request("http://fn.local/functions/v1/supplier-upload", { method: "POST", body: form });
}
async function snapshot(res) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()].sort() };
}
const bodies = (calls) => calls.map((c) => `${c.url} ${typeof c.init.body === "string" ? c.init.body : ""}`);

test("[H03.main] the supplier sees their one request, uploads a PDF to quarantine and the link is used", async () => {
  const b = backend();
  const open = await b.handle(describe(TOKEN));
  assert.equal(open.status, 200);
  assert.deepEqual(await open.json(), { status: "open", workspace_name: "Kruuse Pet Nutrition", supplier_name: "Aldrich Nutrition",
                                        title: "Premix specification", expires_at: "2026-11-24T09:00:00+00:00" });
  const res = await b.handle(upload(TOKEN));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "received" });
  assert.deepEqual([...b.objects.keys()], [`${WS}/${REQ}/Premix-spec-2026.pdf`]);
  const accept = b.calls.find((c) => c.url.endsWith("/rpc/accept_supplier_upload"));
  const args = JSON.parse(accept.init.body);
  assert.equal(args.p_path, `${WS}/${REQ}/Premix-spec-2026.pdf`);
  assert.match(args.p_sha256, /^[0-9a-f]{64}$/);
  assert.equal(accept.init.headers["Content-Profile"], "app");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.test");
});

test("[H03.main] DOCX and XLSX are accepted by their part names", async () => {
  for (const [bytes, type, ext] of [[DOCX_BYTES, TYPES.docx, "docx"], [XLSX_BYTES, TYPES.xlsx, "xlsx"]]) {
    const b = backend();
    const res = await b.handle(upload(TOKEN, bytes, { type, name: `sheet.${ext}` }));
    assert.equal(res.status, 200, ext);
    assert.deepEqual([...b.objects.keys()], [`${WS}/${REQ}/sheet.${ext}`]);
  }
});

test("[H03.must.1] the token reaches the two link functions in a POST body only, never Storage, a URL or a log", async () => {
  const b = backend();
  await b.handle(upload(TOKEN, PDF_BYTES, { name: "x.pdf" }));
  const withToken = b.calls.filter((c) => typeof c.init.body === "string" && c.init.body.includes(TOKEN));
  assert.deepEqual(withToken.map((c) => new URL(c.url).pathname),
                   ["/rest/v1/rpc/supplier_request_for_token", "/rest/v1/rpc/accept_supplier_upload"]);
  assert.ok(b.calls.every((c) => !c.url.includes(TOKEN)), "never in a URL");
  assert.ok(!JSON.stringify(b.lines).includes(TOKEN), "never logged");
  assert.ok(!JSON.stringify(b.lines).includes(WS), "the workspace is not logged either");
  assert.ok(b.calls.every((c) => c.init.headers.Authorization === `Bearer ${SERVICE}`));
});

test("[H03.must.1] single use: a second upload with the same link stores nothing and gets the generic answer", async () => {
  const b = backend();
  assert.equal((await b.handle(upload(TOKEN, PDF_BYTES, { name: "a.pdf" }))).status, 200);
  const again = await b.handle(upload(TOKEN, PDF_BYTES, { name: "b.pdf" }));
  assert.equal(again.status, 404);
  assert.deepEqual(await again.json(), UNAVAILABLE);
  assert.deepEqual([...b.objects.keys()], [`${WS}/${REQ}/a.pdf`]);
  assert.equal((await b.handle(describe(TOKEN))).status, 404, "and it describes nothing more");
});

test("[H03.must.1] a link used between the check and the upload leaves no file behind", async () => {
  const b = backend({ acceptAs: false });
  const res = await b.handle(upload(TOKEN));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), UNAVAILABLE);
  assert.equal(b.objects.size, 0);
  assert.ok(b.calls.some((c) => c.init.method === "DELETE"));
});

test("[H03.fail.1] expired, used, unknown and malformed links get the same answer, before any file check", async () => {
  const answers = [];
  for (const [state, token] of [["expired", TOKEN], ["used", TOKEN], ["open", OTHER], ["open", "short"], ["open", undefined]]) {
    const b = backend({ state });
    answers.push(await snapshot(await b.handle(describe(token))));
    answers.push(await snapshot(await b.handle(upload(token, enc("MZ not a pdf"), { type: "application/x-msdownload" }))));
    assert.equal(b.objects.size, 0);
  }
  for (const a of answers) assert.deepEqual(a, answers[0]);
  assert.equal(answers[0].status, 404);
  assert.equal(answers[0].body, JSON.stringify(UNAVAILABLE));
});

test("[H03.main] a type that the bytes do not prove, an empty file or one over 25 MiB is refused and nothing is stored", async () => {
  const cases = [
    [enc("MZ\x90\x00 executable"), TYPES.pdf, 415],                // magic bytes say no
    [PDF_BYTES, "application/msword", 415],                          // declared type disagrees
    [DOCX_BYTES, TYPES.xlsx, 415],                                    // DOCX dressed as XLSX
    [zip("word/document.xml", "xl/workbook.xml"), TYPES.docx, 415],  // ambiguous package
    [new Uint8Array(0), TYPES.pdf, 400],
  ];
  for (const [bytes, type, status] of cases) {
    const b = backend();
    const res = await b.handle(upload(TOKEN, bytes, { type }));
    assert.equal(res.status, status, type);
    assert.equal(b.objects.size, 0);
    assert.ok(!b.calls.some((c) => c.url.includes("accept_supplier_upload")), "the link is not used");
  }
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set(PDF_BYTES);
  const b = backend();
  assert.equal((await b.handle(upload(TOKEN, big))).status, 413);
  assert.equal(b.objects.size, 0);
  const declared = new Request("http://fn.local/x", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x",
                                                                                   "content-length": String(MAX_BYTES * 2) }, body: "x" });
  assert.equal((await b.handle(declared)).status, 413);
});

test("[H03.must.1] an accept whose answer is lost keeps the file, since the database may have committed", async () => {
  const b = backend({ acceptThrows: true });
  const res = await b.handle(upload(TOKEN));
  assert.equal(res.status, 503);
  assert.deepEqual([...b.objects.keys()], [`${WS}/${REQ}/Premix-spec-2026.pdf`]);
  assert.ok(!b.calls.some((c) => c.init.method === "DELETE"));
});

test("[T-802] OPTIONS answers CORS, other methods 405, unavailability 503, and the rate limit 429", async () => {
  const b = backend();
  const pre = await b.handle(new Request("http://fn.local/x", { method: "OPTIONS" }));
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-methods"), /POST/);
  assert.equal((await b.handle(new Request("http://fn.local/x"))).status, 405);
  assert.equal((await backend({ rpcStatus: 500 }).handle(describe(TOKEN))).status, 503);
  const off = makeHandler({ supabaseUrl: "", serviceKey: "", log: () => {} });
  assert.equal((await off(describe(TOKEN))).status, 503);
  const limited = makeHandler({ supabaseUrl: "http://db.local", serviceKey: SERVICE, log: () => {}, now: () => 0,
                                limiter: makeLimiter({ perClient: 1 }), fetchFn: async () => Response.json({ status: "unknown" }) });
  assert.equal((await limited(describe(TOKEN))).status, 404);
  const res = await limited(describe(TOKEN));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
});

test("[T-802] sniff and safeName", () => {
  assert.equal(sniff(PDF_BYTES), "pdf");
  assert.equal(sniff(DOCX_BYTES), "docx");
  assert.equal(sniff(XLSX_BYTES), "xlsx");
  assert.equal(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null);
  assert.equal(safeName("../../etc/passwd", "pdf"), "passwd.pdf");
  assert.equal(safeName("Spécification.exe", "pdf"), "Specification.pdf");
  assert.equal(safeName("", "xlsx"), "document.xlsx");
  assert.match(safeName("x".repeat(500), "pdf"), /^[A-Za-z0-9._-]{1,120}$/);
});
