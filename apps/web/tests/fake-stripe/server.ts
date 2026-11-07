// The fake Stripe over HTTP for the e2e run (T-703). scripts/ci/e2e.sh points the web server at it with
// STRIPE_API_BASE and a test-mode key, and the Playwright global setup starts it on that port. Besides Stripe's
// /v1 API it serves:
//   GET  /pay/<session>          the hosted Checkout page: billing name, address, VAT number and a Pay button
//   POST /pay/<session>          pays the session and redirects to its success_url, as Stripe does
//   GET  /portal/<customer>      the customer portal, as a page that links back
//   GET  /__fake/payments/<cs>   what paying produced (the events the webhook would deliver), for the test to store
//   GET  /__fake/requests        every API request so far, for tests that check what reached Stripe
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decode, FakeStripe, type Json } from "./core";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function startFakeStripe(port: number): Promise<{ url: string; close: () => Promise<void>; fake: FakeStripe }> {
  const base = `http://127.0.0.1:${port}`;
  const fake = new FakeStripe(base);
  const payments = new Map<string, Json>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", base);
      const body = Buffer.concat(chunks).toString("utf8");
      const method = (req.method ?? "GET").toUpperCase();
      const send = (status: number, payload: unknown, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };
      try {
        if (url.pathname === "/favicon.ico") {
          res.writeHead(204);
          return res.end();
        }
        if (url.pathname.startsWith("/v1/")) {
          if (!/^Bearer (sk|rk)_test_/.test(String(req.headers.authorization ?? ""))) {
            return send(401, { error: { type: "invalid_request_error", code: "api_key_invalid", message: "test keys only" } });
          }
          const params = method === "POST" ? decode(body) : decode(url.search.replace(/^\?/, ""));
          const idem = req.headers["idempotency-key"];
          const a = fake.handle({ method, path: url.pathname, params, idempotencyKey: typeof idem === "string" ? idem : undefined });
          return send(a.status, a.body);
        }
        const pay = /^\/pay\/(cs_[A-Za-z0-9_]+)$/.exec(url.pathname);
        if (pay && method === "GET") {
          const s = fake.sessions.get(pay[1]);
          if (!s) return send(404, "no such session", "text/plain");
          return send(
            200,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake Stripe Checkout</title></head><body>
<main><h1>Fake Stripe Checkout</h1><form method="post">
<label>Billing name <input name="name" value="${esc(String((fake.customers.get(String(s.customer))?.name as string) ?? ""))}"></label>
<label>Address line 1 <input name="line1" value="Hafenstraße 12"></label>
<label>Postal code <input name="postal_code" value="20457"></label>
<label>City <input name="city" value="Hamburg"></label>
<label>Country <input name="country" value="DE"></label>
<label>VAT number <input name="vat" value=""></label>
<button type="submit">Pay</button></form></main></body></html>`,
            "text/html; charset=utf-8",
          );
        }
        if (pay && method === "POST") {
          const f = decode(body) as Record<string, string>;
          const done = fake.pay(pay[1], {
            name: f.name || "Customer",
            address: { line1: f.line1 || null, line2: null, postal_code: f.postal_code || null, city: f.city || null, country: (f.country || "").toUpperCase() || null },
            vat: f.vat ? f.vat.toUpperCase() : undefined,
          });
          payments.set(pay[1], { events: done.events, subscription: done.subscription, invoice: done.invoice });
          res.writeHead(303, { location: done.successUrl });
          return res.end();
        }
        const portal = /^\/portal\/(cus_[A-Za-z0-9_]+)$/.exec(url.pathname);
        if (portal) {
          const s = [...fake.portalSessions].reverse().find((p) => p.customer === portal[1]);
          const back = String(s?.return_url ?? "/");
          return send(200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake Stripe portal</title></head><body><main><h1>Fake Stripe portal</h1><p>Flow: ${esc(String((s?.flow_data as Json | undefined)?.type ?? "home"))}</p><a href="${esc(back)}">Return to Nutrivo</a></main></body></html>`, "text/html; charset=utf-8");
        }
        const p = /^\/__fake\/payments\/(cs_[A-Za-z0-9_]+)$/.exec(url.pathname);
        if (p) return payments.has(p[1]) ? send(200, payments.get(p[1])) : send(404, { error: "not paid" });
        if (url.pathname === "/__fake/requests") return send(200, fake.requests);
        return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "not served by the fake" } });
      } catch (e) {
        return send(500, { error: { type: "api_error", message: e instanceof Error ? e.message : String(e) } });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: bound } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${bound}`, fake, close: () => new Promise((r) => server.close(() => r())) };
}
