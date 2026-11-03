// A small in-memory Stripe for the web's billing tests (T-703): the unit tests call it as a fetch stub and the e2e run
// serves it over HTTP (server.ts), with STRIPE_API_BASE pointing the web server at it. It answers only the calls
// apps/web/src/lib/billing makes, with the fields those calls read, in test mode (livemode: false). Prices come from
// the catalogue config/pricing.ts describes (docs/08), so lookup keys match the real catalogue's.
import { addons, plans } from "../../../../config/pricing";

export type Json = Record<string, unknown>;
export type Request = { method: string; path: string; params: Json; idempotencyKey?: string };
export type Answer = { status: number; body: Json };

/** Stripe's form encoding, decoded: a[b][0][c]=v → { a: { b: [ { c: "v" } ] } }. */
export function decode(form: string): Json {
  const out: Json = {};
  for (const pair of form.split("&")) {
    if (!pair) continue;
    const [rawK, rawV = ""] = pair.split("=");
    const key = decodeURIComponent(rawK.replace(/\+/g, " "));
    const value = decodeURIComponent(rawV.replace(/\+/g, " "));
    const parts = key.split(/\[|\]\[|\]/).filter((p) => p !== "");
    let node: Record<string, unknown> | unknown[] = out;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]);
      const k = Array.isArray(node) ? Number(part) : part;
      const holder = node as Record<string | number, unknown>;
      if (last) {
        if (key.endsWith("[]")) ((holder[k] as unknown[]) ??= []).push(value);
        else holder[k] = value;
      } else {
        holder[k] ??= nextIsIndex ? [] : {};
        node = holder[k] as Record<string, unknown> | unknown[];
      }
    });
  }
  return out;
}

let seq = 0;
const id = (prefix: string) => `${prefix}_fake${(++seq).toString(36).padStart(6, "0")}${Math.random().toString(36).slice(2, 8)}`;
const now = () => Math.floor(Date.now() / 1000);

type Customer = Json & { id: string; metadata: Record<string, string>; tax_ids: Json[]; invoice_settings: Json; address: Json | null };

export class FakeStripe {
  readonly requests: Request[] = [];
  readonly customers = new Map<string, Customer>();
  readonly prices = new Map<string, Json>();
  readonly sessions = new Map<string, Json>();
  readonly portalConfigs: Json[] = [];
  readonly portalSessions: Json[] = [];
  readonly paymentMethods = new Map<string, Json[]>();
  readonly subscriptions = new Map<string, Json>();
  readonly invoices = new Map<string, Json>();
  private readonly idem = new Map<string, Answer>();

  constructor(readonly base = "http://fake-stripe.test") {
    for (const p of plans.filter((x) => x.billable)) {
      for (const price of p.prices) {
        const key = `nutrivo_plan_${p.key}_${price.currency}_${price.interval}`;
        this.prices.set(key, {
          id: `price_${key}`, object: "price", lookup_key: key, unit_amount: price.amount, currency: price.currency, active: true,
          product: `nutrivo_plan_${p.key}`, tax_behavior: "exclusive", recurring: { interval: price.interval },
          metadata: { nutrivo_kind: "plan", nutrivo_plan: p.key, nutrivo_interval: price.interval },
        });
      }
    }
    for (const a of addons) {
      for (const [plan, prices] of Object.entries(a.prices)) {
        for (const price of prices ?? []) {
          const key = `nutrivo_addon_${a.key}_${plan}_${price.currency}_${price.interval}`;
          this.prices.set(key, { id: `price_${key}`, object: "price", lookup_key: key, unit_amount: price.amount, currency: price.currency, active: true });
        }
      }
    }
  }

  /** One request, as the Stripe API would answer it (the subset the web uses). */
  handle(req: Request): Answer {
    this.requests.push(req);
    if (req.idempotencyKey && this.idem.has(req.idempotencyKey)) return this.idem.get(req.idempotencyKey)!;
    const answer = this.route(req);
    if (req.idempotencyKey && answer.status < 400) this.idem.set(req.idempotencyKey, answer);
    return answer;
  }

  private route({ method, path, params }: Request): Answer {
    const ok = (body: Json) => ({ status: 200, body: { livemode: false, ...body } });
    const missing = () => ({ status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such object" } } });
    const seg = path.split("/").filter(Boolean); // ["v1", "customers", ...]
    if (seg[0] !== "v1") return missing();
    const [, res, a, b, c] = seg;

    if (res === "prices" && method === "GET") {
      const keys = (params.lookup_keys as string[]) ?? [];
      return ok({ object: "list", data: keys.map((k) => this.prices.get(k)).filter(Boolean) as Json[] });
    }

    if (res === "customers") {
      if (method === "GET" && a === "search") {
        const m = /metadata\['workspace_id'\]:'([^']+)'/.exec(String(params.query ?? ""));
        const data = [...this.customers.values()].filter((x) => m && x.metadata.workspace_id === m[1]).map((x) => this.customerOut(x));
        return ok({ object: "search_result", data });
      }
      if (method === "POST" && !a) {
        const cust: Customer = {
          id: id("cus"), object: "customer", name: (params.name as string) ?? null, email: null, address: null,
          metadata: (params.metadata as Record<string, string>) ?? {}, tax_ids: [], invoice_settings: { custom_fields: null, default_payment_method: null },
        };
        this.customers.set(cust.id, cust);
        return ok(this.customerOut(cust));
      }
      const cust = a ? this.customers.get(a) : undefined;
      if (!cust) return missing();
      if (method === "GET" && !b) return ok(this.customerOut(cust));
      if (method === "POST" && !b) {
        if (params.name !== undefined) cust.name = params.name;
        if (params.email !== undefined) cust.email = params.email || null;
        if (params.address) cust.address = { line1: null, line2: null, postal_code: null, city: null, country: null, ...(params.address as Json) };
        if (params.metadata) cust.metadata = { ...cust.metadata, ...(params.metadata as Record<string, string>) };
        const inv = params.invoice_settings as Json | undefined;
        if (inv && "custom_fields" in inv) cust.invoice_settings.custom_fields = inv.custom_fields === "" ? null : inv.custom_fields;
        return ok(this.customerOut(cust));
      }
      if (b === "tax_ids") {
        if (method === "POST") {
          const value = String(params.value);
          if (!/^[A-Z]{2}[A-Z0-9]{2,14}$/.test(value)) return { status: 400, body: { error: { type: "invalid_request_error", code: "tax_id_invalid", message: "Invalid value" } } };
          // VIES answers asynchronously in Stripe; the fake verifies at once.
          const t = { id: id("txi"), object: "tax_id", type: params.type, value, verification: { status: "verified" } };
          cust.tax_ids.push(t);
          return ok(t);
        }
        if (method === "DELETE" && c) {
          cust.tax_ids = cust.tax_ids.filter((t) => t.id !== c);
          return ok({ id: c, deleted: true });
        }
      }
      if (b === "payment_methods" && method === "GET") return ok({ object: "list", data: this.paymentMethods.get(cust.id) ?? [] });
    }

    if (res === "checkout" && a === "sessions") {
      if (method === "POST" && !b) {
        const sid = id("cs_test");
        const session = { id: sid, object: "checkout.session", status: "open", payment_status: "unpaid", invoice: null, subscription: null, url: `${this.base}/pay/${sid}`, ...params };
        this.sessions.set(sid, session);
        return ok(session);
      }
      if (method === "GET" && b) {
        const s = this.sessions.get(b);
        return s ? ok(s) : missing();
      }
    }

    if (res === "billing_portal") {
      if (a === "configurations" && method === "GET") return ok({ object: "list", data: this.portalConfigs });
      if (a === "configurations" && method === "POST") {
        const conf = { id: id("bpc"), object: "billing_portal.configuration", active: true, ...params };
        this.portalConfigs.push(conf);
        return ok(conf);
      }
      if (a === "sessions" && method === "POST") {
        const s = { id: id("bps"), object: "billing_portal.session", url: `${this.base}/portal/${String(params.customer)}`, ...params };
        this.portalSessions.push(s);
        return ok(s);
      }
    }

    if (res === "invoices" && a === "create_preview" && method === "POST") {
      const cust = this.customers.get(String(params.customer));
      if (!cust) return missing();
      const items = ((params.subscription_details as Json)?.items as Json[]) ?? [];
      const price = [...this.prices.values()].find((p) => p.id === items[0]?.price);
      return ok(this.invoiceFor(cust, price ?? {}, "in_preview", false));
    }

    return missing();
  }

  private customerOut(c: Customer): Json {
    const def = c.invoice_settings.default_payment_method as string | null;
    return { ...c, tax_ids: { object: "list", data: c.tax_ids }, invoice_settings: { ...c.invoice_settings, default_payment_method: def } };
  }

  /** Stripe Tax as the fake applies it (docs/08 VAT): Swedish VAT 25% in Sweden; reverse charge for an EU business
   * with a verified VAT number; the customer's own rate (a flat 19% here) for an EU customer without one; none outside. */
  invoiceFor(cust: Customer, price: Json, invoiceId: string, paid: boolean): Json {
    const subtotal = Number(price.unit_amount ?? 0);
    const country = String((cust.address as Json | null)?.country ?? "");
    const eu = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ").includes(country);
    const vatId = cust.tax_ids.find((t) => (t.verification as Json)?.status === "verified");
    let tax = 0;
    let reason = "not_collecting";
    let exempt = "none";
    if (country === "SE") {
      tax = Math.round(subtotal * 0.25);
      reason = "standard_rated";
    } else if (eu && vatId) {
      reason = "reverse_charge";
      exempt = "reverse";
    } else if (eu) {
      tax = Math.round(subtotal * 0.19);
      reason = "standard_rated";
    }
    const total = subtotal + tax;
    const start = now();
    const interval = (price.recurring as Json | undefined)?.interval === "year" ? 365 : 30;
    return {
      id: invoiceId, object: "invoice", number: paid ? `NTV-FAKE-${String(this.invoices.size + 1).padStart(4, "0")}` : null,
      status: paid ? "paid" : "draft", created: start, currency: "eur", customer: cust.id,
      customer_name: cust.name, customer_address: cust.address, customer_tax_exempt: exempt,
      customer_tax_ids: cust.tax_ids.map((t) => ({ type: t.type, value: t.value })),
      subtotal, subtotal_excluding_tax: subtotal, total, amount_paid: paid ? total : 0, amount_due: paid ? 0 : total,
      total_taxes: [{ amount: tax, taxable_amount: subtotal, taxability_reason: reason, tax_behavior: "exclusive" }],
      invoice_pdf: paid ? `${this.base}/invoice/${invoiceId}.pdf` : null, hosted_invoice_url: paid ? `${this.base}/invoice/${invoiceId}` : null,
      lines: { object: "list", data: [{ description: `1 × ${String(price.product ?? "plan").replace("nutrivo_plan_", "")}`, amount: subtotal, quantity: 1,
        period: { start, end: start + interval * 86400 }, price: { lookup_key: price.lookup_key ?? null, metadata: price.metadata ?? {} } }] },
    };
  }

  /**
   * The customer pays the Checkout Session: the address and VAT number Stripe would collect are set on the customer,
   * a card is put on file, and the subscription and its first paid invoice exist. Returns the Stripe events the
   * webhook would deliver (the e2e test stores them through app.record_stripe_event), and the success URL.
   */
  pay(sessionId: string, billing: { name: string; address: Json; vat?: string }): { successUrl: string; events: Json[]; subscription: Json; invoice: Json } {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`no session ${sessionId}`);
    const cust = this.customers.get(String(s.customer))!;
    cust.name = billing.name;
    cust.address = billing.address;
    if (billing.vat) cust.tax_ids = [{ id: id("txi"), object: "tax_id", type: "eu_vat", value: billing.vat, verification: { status: "verified" } }];
    const pm = { id: id("pm"), object: "payment_method", type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 }, billing_details: { name: billing.name } };
    this.paymentMethods.set(cust.id, [pm]);
    cust.invoice_settings.default_payment_method = pm.id;
    const item = ((s.line_items as Json[]) ?? [])[0] ?? {};
    const price = [...this.prices.values()].find((p) => p.id === item.price) ?? {};
    const subId = id("sub");
    const invId = id("in");
    const invoice = this.invoiceFor(cust, price, invId, true);
    (invoice as Json).subscription = subId;
    this.invoices.set(invId, invoice);
    const interval = (price.recurring as Json | undefined)?.interval === "year" ? 365 : 30;
    const subscription = {
      id: subId, object: "subscription", customer: cust.id, status: "active", metadata: (s.subscription_data as Json)?.metadata ?? {},
      current_period_end: now() + interval * 86400, items: { data: [{ price, quantity: 1 }] },
    };
    this.subscriptions.set(subId, subscription);
    Object.assign(s, { status: "complete", payment_status: "paid", invoice: invId, subscription: subId });
    const event = (type: string, object: Json) => ({ id: id("evt"), object: "event", type, created: now(), livemode: false, data: { object } });
    return {
      successUrl: String(s.success_url).replace("{CHECKOUT_SESSION_ID}", sessionId),
      events: [event("checkout.session.completed", s), event("customer.subscription.created", subscription), event("invoice.paid", invoice)],
      subscription,
      invoice,
    };
  }

  /** A fetch stub that answers from this fake (unit tests). */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const params = method === "POST" ? decode(String(init?.body ?? "")) : decode(url.search.replace(/^\?/, ""));
    const answer = this.handle({ method, path: url.pathname, params, idempotencyKey: headers.get("idempotency-key") ?? undefined });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  };
}
