// make stripe-catalogue: create or update the Stripe catalogue from config/pricing.ts, in TEST mode only.
// Idempotent: products have fixed ids (nutrivo_plan_basic, nutrivo_addon_region, ...) and prices are found by
// lookup_key (nutrivo_plan_basic_eur_month, ...), so a re-run changes nothing. Prices are immutable in Stripe, so a
// changed amount creates a new price that takes over the lookup key, and the old one is archived, never deleted.
// Usage: scripts/env/run.sh dev -- node scripts/stripe/catalogue.ts [--dry-run]
// The key comes from STRIPE_SECRET_KEY and is never printed. Anything but sk_test_/rk_test_ is refused, and a
// response that reports livemode aborts the run.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { addons, plans } from "../../config/pricing.ts";
import type { Interval, Price } from "../../config/pricing.ts";

export const PREFIX = "nutrivo_";
const API = "https://api.stripe.com/v1";

export type Metadata = Record<string, string>;

export interface DesiredPrice {
  lookup_key: string;
  product: string;
  currency: string;
  unit_amount: number;
  interval: Interval;
  metadata: Metadata;
}

export interface DesiredProduct {
  id: string;
  name: string;
  metadata: Metadata;
  prices: DesiredPrice[];
}

// The subset of Stripe's objects the script reads.
export interface StripeProduct {
  id: string;
  name: string;
  active: boolean;
  metadata: Metadata;
  livemode?: boolean;
}

export interface StripePrice {
  id: string;
  product: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  lookup_key: string | null;
  tax_behavior: string | null;
  recurring: { interval: string; interval_count: number; usage_type?: string } | null;
  metadata: Metadata;
  livemode?: boolean;
}

export type Action =
  | { kind: "create_product"; product: DesiredProduct }
  | { kind: "update_product"; id: string; name: string; metadata: Metadata; why: string }
  | { kind: "create_price"; price: DesiredPrice }
  | { kind: "replace_price"; old: string; price: DesiredPrice; why: string }
  | { kind: "update_price"; id: string; lookup_key: string; metadata: Metadata; why: string }
  | { kind: "archive_price"; id: string; lookup_key: string | null };

const str = (v: number | null) => (v === null ? "unlimited" : String(v));

function priceRows(product: string, prices: Price[], meta: Metadata, keyPart: string): DesiredPrice[] {
  return prices.map((p) => ({
    lookup_key: `${keyPart}_${p.currency}_${p.interval}`,
    product,
    currency: p.currency,
    unit_amount: p.amount,
    interval: p.interval,
    metadata: { ...meta, nutrivo_interval: p.interval },
  }));
}

/** The catalogue config/pricing.ts describes: one product per paid plan, one per add-on, one price per currency,
 * term and (for add-ons) plan. The free allowance has no product (D-21). */
export function desiredCatalogue(): DesiredProduct[] {
  const out: DesiredProduct[] = [];
  for (const plan of plans.filter((p) => p.billable)) {
    const id = `${PREFIX}plan_${plan.key}`;
    const metadata: Metadata = {
      nutrivo_catalogue: "pricing.ts",
      nutrivo_kind: "plan",
      nutrivo_plan: plan.key,
      recipes: str(plan.recipes),
      editors: str(plan.editors),
      regions_included: String(plan.regionsIncluded),
      regions_max: String(plan.regionsMax),
      overage_cap: str(plan.overageCap),
      price_from: String(plan.from),
    };
    out.push({ id, name: `Nutrivo ${plan.name}`, metadata,
      prices: priceRows(id, plan.prices, { nutrivo_kind: "plan", nutrivo_plan: plan.key }, id) });
  }
  for (const addon of addons) {
    const id = `${PREFIX}addon_${addon.key}`;
    const forPlans = Object.keys(addon.prices).sort();
    const prices = forPlans.flatMap((planKey) =>
      priceRows(id, addon.prices[planKey as keyof typeof addon.prices] ?? [],
        { nutrivo_kind: "addon", nutrivo_addon: addon.key, nutrivo_plan: planKey }, `${id}_${planKey}`));
    out.push({ id, name: `Nutrivo ${addon.name}`, prices, metadata: {
      nutrivo_catalogue: "pricing.ts", nutrivo_kind: "addon", nutrivo_addon: addon.key, plans: forPlans.join(","),
    } });
  }
  return out;
}

/** Keys in `want` whose value differs in `have` (Stripe merges metadata, so extra keys are left alone). */
function metaDiff(want: Metadata, have: Metadata): string[] {
  return Object.keys(want).filter((k) => have[k] !== want[k]);
}

/** Why an existing price cannot serve `want` without being replaced (prices are immutable), or "". */
function immutableDiff(want: DesiredPrice, have: StripePrice): string {
  const why: string[] = [];
  if (have.product !== want.product) why.push(`product ${have.product}`);
  if (have.currency !== want.currency) why.push(`currency ${have.currency}`);
  if (have.unit_amount !== want.unit_amount) why.push(`amount ${have.unit_amount} -> ${want.unit_amount}`);
  if (have.recurring?.interval !== want.interval || have.recurring?.interval_count !== 1) {
    why.push(`interval ${have.recurring?.interval ?? "one-off"}`);
  }
  if (have.recurring?.usage_type && have.recurring.usage_type !== "licensed") why.push(`usage ${have.recurring.usage_type}`);
  if (have.tax_behavior !== "exclusive") why.push(`tax_behavior ${have.tax_behavior}`);
  return why.join(", ");
}

/** What to do to turn the current catalogue into the desired one. Pure: no network, so it is tested directly.
 * `prices` holds every price that carries a desired lookup key, plus every price of the nutrivo_ products. */
export function diff(desired: DesiredProduct[], products: StripeProduct[], prices: StripePrice[]): Action[] {
  const actions: Action[] = [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const byKey = new Map(prices.filter((p) => p.lookup_key).map((p) => [p.lookup_key as string, p]));
  const wanted = new Set<string>();
  for (const want of desired) {
    const have = byId.get(want.id);
    if (!have) {
      actions.push({ kind: "create_product", product: want });
    } else {
      const why = [!have.active && "inactive", have.name !== want.name && `name '${have.name}'`,
        ...metaDiff(want.metadata, have.metadata).map((k) => `metadata.${k}`)].filter(Boolean).join(", ");
      if (why) actions.push({ kind: "update_product", id: want.id, name: want.name, metadata: want.metadata, why });
    }
    for (const price of want.prices) {
      const cur = byKey.get(price.lookup_key);
      if (cur) wanted.add(cur.id);
      if (!cur) {
        actions.push({ kind: "create_price", price });
      } else if (immutableDiff(price, cur)) {
        actions.push({ kind: "replace_price", old: cur.id, price, why: immutableDiff(price, cur) });
      } else {
        const why = [!cur.active && "inactive", ...metaDiff(price.metadata, cur.metadata).map((k) => `metadata.${k}`)]
          .filter(Boolean).join(", ");
        if (why) actions.push({ kind: "update_price", id: cur.id, lookup_key: price.lookup_key, metadata: price.metadata, why });
      }
    }
  }
  // Active prices on our products that config/pricing.ts no longer names: archived, so checkout cannot sell them.
  const ours = new Set(desired.map((d) => d.id));
  for (const p of prices) {
    if (p.active && ours.has(p.product) && !wanted.has(p.id)) {
      actions.push({ kind: "archive_price", id: p.id, lookup_key: p.lookup_key });
    }
  }
  return actions;
}

export function describe(a: Action): string {
  switch (a.kind) {
    case "create_product": return `create product ${a.product.id} '${a.product.name}'`;
    case "update_product": return `update product ${a.id} (${a.why})`;
    case "create_price": return `create price ${a.price.lookup_key} ${fmt(a.price)}`;
    case "replace_price": return `replace price ${a.price.lookup_key} ${fmt(a.price)} (${a.why}); archive ${a.old}`;
    case "update_price": return `update price ${a.lookup_key} (${a.why})`;
    case "archive_price": return `archive price ${a.id} (${a.lookup_key ?? "no lookup key"}): not in config/pricing.ts`;
  }
}

function fmt(p: DesiredPrice): string {
  return `${(p.unit_amount / 100).toFixed(2)} ${p.currency.toUpperCase()}/${p.interval}`;
}

/** Only a test-mode key is ever used. */
export function assertTestKey(key: string | undefined): string {
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set: run through scripts/env/run.sh dev -- ...");
  if (/^(sk|rk)_live_/.test(key)) throw new Error("refusing a live Stripe key: this script runs in test mode only");
  if (!/^(sk|rk)_test_/.test(key)) throw new Error("STRIPE_SECRET_KEY is not a test-mode secret or restricted key");
  return key;
}

/** Stripe's form encoding, with nested keys: metadata[a]=b, recurring[interval]=month, lookup_keys[]=x. */
export function form(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const name = prefix ? `${prefix}[${Array.isArray(params) ? "" : k}]` : k;
    if (v !== null && typeof v === "object") out.push(...form(v as Record<string, unknown>, name));
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ status: number; json(): Promise<any> }>;

export class Stripe {
  // Plain fields, not parameter properties: Node's type stripping does not support those.
  private key: string;
  private fetcher: Fetch;
  private sleep: (ms: number) => Promise<unknown>;

  constructor(key: string, fetcher: Fetch = fetch as unknown as Fetch,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    this.key = key;
    this.fetcher = fetcher;
    this.sleep = sleep;
  }

  /** One request, retried at most three times on 429, 5xx or a network error, with the same idempotency key. */
  async call(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}): Promise<any> {
    const body = form(params).join("&");
    const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Idempotency-Key"] = randomUUID();
    }
    for (let attempt = 1; ; attempt++) {
      let res: { status: number; json(): Promise<any> };
      try {
        res = await this.fetcher(url, { method, headers, body: method === "POST" ? body : undefined });
      } catch (e) {
        if (attempt >= 3) throw new Error(`${method} ${path}: ${(e as Error).message}`);
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      const data = await res.json();
      if (res.status === 404 && method === "GET") return null;
      if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${data?.error?.message ?? "error"}`);
      assertTestMode(data);
      return data;
    }
  }

  async list(path: string, params: Record<string, unknown>): Promise<any[]> {
    const out: any[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await this.call("GET", path, { ...params, limit: 100, starting_after: after });
      out.push(...page.data);
      if (!page.has_more) return out;
      after = page.data[page.data.length - 1].id;
    }
  }
}

function assertTestMode(data: any): void {
  const objects = Array.isArray(data?.data) ? data.data : [data];
  if (objects.some((o: any) => o?.livemode === true)) {
    throw new Error("Stripe answered in live mode: aborting, nothing more is written");
  }
}

/** The current state of everything the desired catalogue touches. */
export async function fetchCurrent(stripe: Stripe, desired: DesiredProduct[]) {
  const products: StripeProduct[] = [];
  const prices = new Map<string, StripePrice>();
  for (const d of desired) {
    const p = await stripe.call("GET", `/products/${d.id}`);
    if (p) products.push(p);
    if (p) for (const price of await stripe.list("/prices", { product: d.id })) prices.set(price.id, price);
  }
  // A lookup key is unique across the account, so a price holding one may sit on another product.
  const keys = desired.flatMap((d) => d.prices.map((p) => p.lookup_key));
  for (let i = 0; i < keys.length; i += 10) {
    for (const price of await stripe.list("/prices", { lookup_keys: keys.slice(i, i + 10) })) prices.set(price.id, price);
  }
  return { products, prices: [...prices.values()] };
}

function priceParams(p: DesiredPrice): Record<string, unknown> {
  return { product: p.product, currency: p.currency, unit_amount: p.unit_amount, recurring: { interval: p.interval },
    tax_behavior: "exclusive", lookup_key: p.lookup_key, metadata: p.metadata };
}

export async function apply(stripe: Stripe, a: Action): Promise<void> {
  switch (a.kind) {
    case "create_product":
      await stripe.call("POST", "/products", { id: a.product.id, name: a.product.name, metadata: a.product.metadata });
      return;
    case "update_product":
      await stripe.call("POST", `/products/${a.id}`, { name: a.name, active: true, metadata: a.metadata });
      return;
    case "create_price":
      await stripe.call("POST", "/prices", priceParams(a.price));
      return;
    case "replace_price":
      await stripe.call("POST", "/prices", { ...priceParams(a.price), transfer_lookup_key: true });
      await stripe.call("POST", `/prices/${a.old}`, { active: false });
      return;
    case "update_price":
      await stripe.call("POST", `/prices/${a.id}`, { active: true, metadata: a.metadata });
      return;
    case "archive_price":
      await stripe.call("POST", `/prices/${a.id}`, { active: false });
      return;
  }
}

/** Plan and (unless dryRun) apply; returns the actions taken, in order. */
export async function sync(stripe: Stripe, opts: { dryRun?: boolean; log?: (line: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const desired = desiredCatalogue();
  const { products, prices } = await fetchCurrent(stripe, desired);
  const actions = diff(desired, products, prices);
  for (const a of actions) {
    log(`${opts.dryRun ? "would " : ""}${describe(a)}`);
    if (!opts.dryRun) await apply(stripe, a);
  }
  const total = desired.reduce((n, d) => n + d.prices.length, 0);
  log(`${actions.length} change(s)${opts.dryRun ? " planned" : ""}; catalogue: ${desired.length} products, ${total} prices (test mode)`);
  return actions;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const key = assertTestKey(process.env.STRIPE_SECRET_KEY);
  await sync(new Stripe(key), { dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(`stripe-catalogue failed: ${e.message}`);
    process.exit(1);
  });
}
