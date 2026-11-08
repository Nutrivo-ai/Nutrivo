import "server-only";

// T-703: the web server's Stripe calls (Checkout, the customer portal, the customer's billing details, its card and
// invoice previews), over Stripe's REST API with fetch, like scripts/stripe/catalogue.ts and the worker. The secret
// key is STRIPE_SECRET_KEY on the web server (config/secrets.yaml) and is never sent to the browser, logged or put in
// an error. Outside prod only a test key is accepted and a live-mode answer aborts (gate G8 is T-705), and only
// there may STRIPE_API_BASE point the calls at a local fake Stripe (the e2e run).

const API = "https://api.stripe.com";

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

/** A Stripe error answer: the status, Stripe's type and code, never the request or the key. */
export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly code: string | null,
    message: string,
  ) {
    super(`stripe ${status} ${type}${code ? ` ${code}` : ""}: ${message}`);
    this.name = "StripeError";
  }
}

const isProd = () => process.env.NUTRIVO_ENV === "prod";

/** The secret key, checked: outside prod anything but sk_test_/rk_test_ is refused. */
export function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) throw new StripeConfigError("STRIPE_SECRET_KEY is not set");
  if (!isProd() && !/^(sk|rk)_test_/.test(key)) throw new StripeConfigError("outside prod only a Stripe test key is accepted");
  return key;
}

export function stripeBase(): string {
  const override = process.env.STRIPE_API_BASE;
  if (override && !isProd()) return override.replace(/\/+$/, "");
  return API;
}

export type Params = { [k: string]: Param };
type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

/** Stripe's form encoding: nested objects as a[b]=, arrays as a[0]=; null and undefined are left out. */
export function encode(params: Params): string {
  const out: string[] = [];
  const walk = (prefix: string, v: Param) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    else if (typeof v === "object") for (const [k, item] of Object.entries(v)) walk(`${prefix}[${k}]`, item);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

/** One call. GET params go in the query string; POST params in the body, with an idempotency key when given. */
export async function stripe<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params = {},
  opts: { idempotencyKey?: string } = {},
): Promise<T> {
  const key = stripeKey();
  const body = encode(params);
  const url = `${stripeBase()}${path}${method !== "POST" && body ? `?${body}` : ""}`;
  // No Stripe-Version header: the account's default version, as the worker and the catalogue script use.
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(url, { method, headers, body: method === "POST" ? body : undefined, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const e = (json.error ?? {}) as { type?: string; code?: string; message?: string };
    throw new StripeError(res.status, e.type ?? "api_error", e.code ?? null, e.message ?? "no message");
  }
  if (!isProd() && json.livemode === true) throw new StripeConfigError("Stripe answered in live mode outside prod");
  return json as T;
}

// ── The subset of Stripe's objects the web reads ────────────────────────────────────────────────────────────────

export type Address = {
  line1: string | null;
  line2: string | null;
  postal_code: string | null;
  city: string | null;
  state?: string | null;
  country: string | null;
};

export type TaxId = {
  id: string;
  type: string;
  value: string;
  verification: { status: "pending" | "verified" | "unverified" | "unavailable"; verified_name?: string | null } | null;
};

export type Card = { brand: string; last4: string; exp_month: number; exp_year: number };
export type PaymentMethod = { id: string; type: string; card?: Card; billing_details?: { name: string | null } };

export type Customer = {
  id: string;
  deleted?: boolean;
  name: string | null;
  email: string | null;
  address: Address | null;
  metadata: Record<string, string>;
  tax_exempt?: "none" | "exempt" | "reverse";
  tax_ids?: { data: TaxId[] };
  invoice_settings?: {
    custom_fields: { name: string; value: string }[] | null;
    default_payment_method: string | PaymentMethod | null;
  };
};

export type Price = { id: string; lookup_key: string | null; unit_amount: number | null; currency: string };
