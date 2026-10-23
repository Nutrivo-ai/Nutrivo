// node --test scripts/stripe/: the catalogue mapping and idempotency, against an in-memory Stripe (no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addons, plans } from "../../config/pricing.ts";
import { assertTestKey, desiredCatalogue, diff, form, Stripe, sync } from "./catalogue.ts";
import type { Fetch, StripePrice, StripeProduct } from "./catalogue.ts";

/** Enough of the Stripe API for the script: products by id, prices by product or lookup key, create and update. */
function fakeStripe(opts: { livemode?: boolean; failFirst?: number } = {}) {
  const products = new Map<string, any>();
  const prices = new Map<string, any>();
  const writes: string[] = [];
  let n = 0;
  let failures = opts.failFirst ?? 0;
  const ok = (data: unknown, status = 200) => ({ status, json: async () => data });
  const live = (o: any) => ({ ...o, livemode: !!opts.livemode });
  const meta = (q: URLSearchParams) => Object.fromEntries([...q].filter(([k]) => k.startsWith("metadata["))
    .map(([k, v]) => [k.slice(9, -1), v]));
  const fetcher: Fetch = async (url, init) => {
    if (failures > 0) { failures--; return ok({ error: { message: "try again" } }, 500); }
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, "");
    const q = init.method === "GET" ? u.searchParams : new URLSearchParams(init.body ?? "");
    if (init.method === "POST") {
      writes.push(`${path} ${init.body}`);
      assert.ok(init.headers["Idempotency-Key"], "every write carries an idempotency key");
    }
    let m;
    if (init.method === "GET" && (m = path.match(/^\/products\/(.+)$/))) {
      const p = products.get(m[1]);
      return p ? ok(live(p)) : ok({ error: { message: "No such product" } }, 404);
    }
    if (init.method === "GET" && path === "/prices") {
      const keys = q.getAll("lookup_keys[]");
      const all = [...prices.values()].filter((p) =>
        (!q.get("product") || p.product === q.get("product")) && (!keys.length || keys.includes(p.lookup_key)));
      const start = q.get("starting_after") ? all.findIndex((p) => p.id === q.get("starting_after")) + 1 : 0;
      const limit = Number(q.get("limit") ?? 10);
      return ok({ data: all.slice(start, start + limit).map(live), has_more: start + limit < all.length });
    }
    if (init.method === "POST" && path === "/products") {
      const p = { id: q.get("id"), name: q.get("name"), active: true, metadata: meta(q) };
      products.set(p.id!, p);
      return ok(live(p));
    }
    if (init.method === "POST" && (m = path.match(/^\/products\/(.+)$/))) {
      const p = products.get(m[1]);
      Object.assign(p, { name: q.get("name") ?? p.name, active: q.get("active") !== "false" },
        { metadata: { ...p.metadata, ...meta(q) } });
      return ok(live(p));
    }
    if (init.method === "POST" && path === "/prices") {
      const key = q.get("lookup_key");
      const holder = [...prices.values()].find((p) => p.lookup_key === key);
      if (holder && q.get("transfer_lookup_key") !== "true") {
        return ok({ error: { message: "lookup_key already in use" } }, 400);
      }
      if (holder) holder.lookup_key = null;
      const p = { id: `price_${++n}`, product: q.get("product"), active: true, currency: q.get("currency"),
        unit_amount: Number(q.get("unit_amount")), lookup_key: key, tax_behavior: q.get("tax_behavior"),
        recurring: { interval: q.get("recurring[interval]"), interval_count: 1, usage_type: "licensed" },
        metadata: meta(q) };
      prices.set(p.id, p);
      return ok(live(p));
    }
    if (init.method === "POST" && (m = path.match(/^\/prices\/(.+)$/))) {
      const p = prices.get(m[1]);
      Object.assign(p, { active: q.get("active") !== "false", metadata: { ...p.metadata, ...meta(q) } });
      return ok(live(p));
    }
    throw new Error(`fake Stripe: unhandled ${init.method} ${path}`);
  };
  return { products, prices, writes, stripe: new Stripe("sk_test_fake", fetcher, async () => {}) };
}

const quiet = { log: () => {} };

test("only test-mode keys are used; live keys are refused", () => {
  assert.equal(assertTestKey("sk_test_abc"), "sk_test_abc");
  assert.equal(assertTestKey("rk_test_abc"), "rk_test_abc");
  assert.throws(() => assertTestKey("sk_live_abc"), /refusing a live Stripe key/);
  assert.throws(() => assertTestKey("rk_live_abc"), /refusing a live Stripe key/);
  assert.throws(() => assertTestKey("pk_test_abc"), /not a test-mode secret/);
  assert.throws(() => assertTestKey(undefined), /not set/);
  // The message never echoes the key.
  try { assertTestKey("sk_live_SECRETVALUE"); } catch (e) { assert.doesNotMatch((e as Error).message, /SECRETVALUE/); }
});

test("the catalogue maps config/pricing.ts: one product per paid plan and add-on, a price per term and plan", () => {
  const cat = desiredCatalogue();
  const paid = plans.filter((p) => p.billable);
  assert.deepEqual(cat.map((p) => p.id),
    [...paid.map((p) => `nutrivo_plan_${p.key}`), ...addons.map((a) => `nutrivo_addon_${a.key}`)]);
  assert.ok(!cat.some((p) => p.id === "nutrivo_plan_free"), "the free allowance has no Stripe product (D-21)");
  const byKey = new Map(cat.flatMap((p) => p.prices).map((p) => [p.lookup_key, p]));
  for (const plan of paid) {
    for (const price of plan.prices) {
      const row = byKey.get(`nutrivo_plan_${plan.key}_${price.currency}_${price.interval}`);
      assert.ok(row, `${plan.key} ${price.interval}`);
      assert.equal(row.unit_amount, price.amount);
      assert.equal(row.product, `nutrivo_plan_${plan.key}`);
    }
  }
  assert.equal(byKey.get("nutrivo_plan_basic_eur_month")?.unit_amount, 24900);
  assert.equal(byKey.get("nutrivo_plan_standard_eur_year")?.unit_amount, 499000);
  assert.equal(byKey.get("nutrivo_addon_recipe_basic_eur_month")?.unit_amount, 1500);
  assert.equal(byKey.get("nutrivo_addon_recipe_standard_eur_month")?.unit_amount, 1200);
  assert.ok(!byKey.has("nutrivo_addon_region_basic_eur_month"), "Basic cannot add a region");
  const keys = cat.flatMap((p) => p.prices.map((x) => x.lookup_key));
  assert.equal(new Set(keys).size, keys.length, "lookup keys are unique");
  const basic = cat.find((p) => p.id === "nutrivo_plan_basic")!;
  assert.equal(basic.metadata.overage_cap, "37400");
  assert.equal(basic.metadata.recipes, "10");
});

test("form encoding nests metadata, recurring and lookup key arrays", () => {
  assert.deepEqual(form({ a: 1, metadata: { k: "v w" }, recurring: { interval: "month" }, lookup_keys: ["x", "y"],
    skip: undefined }), ["a=1", "metadata%5Bk%5D=v%20w", "recurring%5Binterval%5D=month",
    "lookup_keys%5B%5D=x", "lookup_keys%5B%5D=y"]);
});

test("the first run creates the catalogue and a second run changes nothing", async () => {
  const fake = fakeStripe();
  const cat = desiredCatalogue();
  const first = await sync(fake.stripe, quiet);
  assert.equal(first.filter((a) => a.kind === "create_product").length, cat.length);
  assert.equal(first.filter((a) => a.kind === "create_price").length, cat.flatMap((p) => p.prices).length);
  assert.ok([...fake.prices.values()].every((p) => p.tax_behavior === "exclusive"), "prices are net of VAT");
  const writes = fake.writes.length;
  const second = await sync(fake.stripe, quiet);
  assert.deepEqual(second, []);
  assert.equal(fake.writes.length, writes, "no writes on a re-run");
  assert.equal(fake.prices.size, cat.flatMap((p) => p.prices).length, "no duplicate prices");
});

test("a dry run writes nothing", async () => {
  const fake = fakeStripe();
  const lines: string[] = [];
  const actions = await sync(fake.stripe, { dryRun: true, log: (l) => lines.push(l) });
  assert.ok(actions.length > 0);
  assert.equal(fake.writes.length, 0);
  assert.match(lines.at(-1)!, /planned/);
});

test("a changed amount replaces the price: the new one takes the lookup key and the old one is archived", async () => {
  const fake = fakeStripe();
  await sync(fake.stripe, quiet);
  const old = [...fake.prices.values()].find((p) => p.lookup_key === "nutrivo_plan_basic_eur_month");
  old.unit_amount = 19900; // as if config/pricing.ts had moved on since the last run
  const actions = await sync(fake.stripe, quiet);
  assert.deepEqual(actions.map((a) => a.kind), ["replace_price"]);
  const now = [...fake.prices.values()].filter((p) => p.lookup_key === "nutrivo_plan_basic_eur_month");
  assert.equal(now.length, 1);
  assert.equal(now[0].unit_amount, 24900);
  assert.equal(old.active, false);
  assert.deepEqual(await sync(fake.stripe, quiet), []);
});

test("drift is repaired in place: an archived product or price is reactivated, a renamed product renamed back", async () => {
  const fake = fakeStripe();
  await sync(fake.stripe, quiet);
  fake.products.get("nutrivo_plan_standard").active = false;
  fake.products.get("nutrivo_addon_region").name = "Region";
  [...fake.prices.values()].find((p) => p.lookup_key === "nutrivo_plan_advanced_eur_year").active = false;
  const actions = await sync(fake.stripe, quiet);
  assert.deepEqual(actions.map((a) => a.kind).sort(), ["update_price", "update_product", "update_product"]);
  assert.deepEqual(await sync(fake.stripe, quiet), []);
});

test("a price that config/pricing.ts no longer names is archived, never deleted", () => {
  const desired = desiredCatalogue();
  const products: StripeProduct[] = desired.map((d) => ({ id: d.id, name: d.name, active: true, metadata: d.metadata }));
  const prices: StripePrice[] = desired.flatMap((d) => d.prices).map((p, i) => ({ id: `price_${i}`, product: p.product,
    active: true, currency: p.currency, unit_amount: p.unit_amount, lookup_key: p.lookup_key, tax_behavior: "exclusive",
    recurring: { interval: p.interval, interval_count: 1 }, metadata: p.metadata }));
  assert.deepEqual(diff(desired, products, prices), []);
  prices.push({ ...prices[0], id: "price_stray", lookup_key: "nutrivo_plan_basic_eur_week" });
  assert.deepEqual(diff(desired, products, prices),
    [{ kind: "archive_price", id: "price_stray", lookup_key: "nutrivo_plan_basic_eur_week" }]);
});

test("a live-mode answer aborts the run before any write", async () => {
  const fake = fakeStripe({ livemode: true });
  fake.products.set("nutrivo_plan_basic", { id: "nutrivo_plan_basic", name: "x", active: true, metadata: {} });
  await assert.rejects(sync(fake.stripe, quiet), /live mode/);
  assert.equal(fake.writes.length, 0);
});

test("transient Stripe errors are retried a bounded number of times", async () => {
  const fake = fakeStripe({ failFirst: 2 });
  await sync(fake.stripe, quiet);
  assert.deepEqual(await sync(fake.stripe, quiet), []);
  const failing = fakeStripe({ failFirst: 3 });
  await assert.rejects(sync(failing.stripe, quiet), /500 try again/);
});
