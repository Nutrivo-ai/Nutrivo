import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeStripe, type Json } from "../../../tests/fake-stripe/core";

// The Server Actions against the fake Stripe, with the database's billing context stubbed: what reaches Stripe, and
// that the workspace and the customer always come from app.billing_context, never from the form.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.nutrivo.test", "x-forwarded-proto": "https" }) }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: () => void }) => unknown) => fn({ setTag: () => {} }),
  captureException: vi.fn(),
}));

const WS = "20000000-0000-4000-8703-00000000000a";
const OTHER = "20000000-0000-4000-8703-00000000000b";
type Answer = { data: unknown; error: { code: string; message: string } | null };
let context: Answer;
let counts: Json;
let audited: Answer;
// app.billing_context, app.live_billable_counts and app.record_billing_change, by name.
const rpc = vi.fn(async (name: string, args?: Json): Promise<Answer> => {
  void args;
  if (name === "billing_context") return context;
  if (name === "live_billable_counts") return { data: counts, error: null };
  if (name === "record_billing_change") return audited;
  return { data: null, error: { code: "42883", message: `no ${name}` } };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ schema: () => ({ rpc }) }) }));

const ctx = (over: Json = {}) => ({
  data: { workspace_id: WS, name: "Halden Pet Nutrition", plan: "free", status: "active", stripe_customer_id: null,
    stripe_subscription_id: null, subscription_status: null, term: null, current_period_end: null, ...over },
  error: null,
});

let fake: FakeStripe;
const { startCheckout, openPortal, saveBillingDetails, saveFinanceEmail } = await import("./actions");

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("no redirect");
}

beforeEach(() => {
  fake = new FakeStripe();
  vi.stubGlobal("fetch", fake.fetch);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  vi.stubEnv("STRIPE_API_BASE", "http://fake-stripe.test");
  vi.stubEnv("NUTRIVO_ENV", "ci");
  vi.stubEnv("APP_BASE_URL", "");
  context = ctx();
  counts = { recipes: 8, regions: ["EU"], editor_seats: 3, labels_used: 3, labels_allowed: 3 };
  audited = { data: null, error: null };
  rpc.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sessionParams = () => fake.requests.find((r) => r.method === "POST" && r.path === "/v1/checkout/sessions")!.params as Json;

describe("billing actions (T-703)", () => {
  it("[M01.main] Subscribe: Checkout is created for the admin's own workspace, by lookup key, and redirects to Stripe", async () => {
    const url = await redirectOf(startCheckout(WS, { plan: "standard", term: "monthly" }));
    expect(url).toMatch(/^http:\/\/fake-stripe\.test\/pay\/cs_test_/);
    expect(rpc).toHaveBeenCalledWith("billing_context", { p_ws: WS });
    const p = sessionParams();
    expect(p.mode).toBe("subscription");
    expect(p.client_reference_id).toBe(WS);
    expect((p.subscription_data as Json).metadata).toEqual({ workspace_id: WS });
    expect(p.line_items).toEqual([{ price: "price_nutrivo_plan_standard_eur_month", quantity: "1" }]);
    // The workspace's own customer, made once with its workspace in the metadata.
    const customer = [...fake.customers.values()][0];
    expect(p.customer).toBe(customer.id);
    expect(customer.metadata.workspace_id).toBe(WS);
    // Decision 1 on #64: payment returns to Plan and allowance.
    expect(p.success_url).toBe(`https://app.nutrivo.test/w/${WS}/settings/billing?from=checkout`);
    expect(p.cancel_url).toBe(`https://app.nutrivo.test/w/${WS}/billing/checkout?plan=standard&term=monthly`);
  });

  it("[M01.must.1] Prices are net; VAT is added on the invoice: Checkout uses automatic tax and collects the VAT number", async () => {
    await redirectOf(startCheckout(WS, { plan: "basic", term: "annual" }));
    const p = sessionParams();
    expect(p.automatic_tax).toEqual({ enabled: "true" });
    expect(p.tax_id_collection).toEqual({ enabled: "true" });
    expect(p.billing_address_collection).toBe("required");
    expect(p.customer_update).toEqual({ address: "auto", name: "auto" });
    // The catalogue price it charges is net: Stripe adds the tax on top (tax_behavior exclusive).
    expect(fake.prices.get("nutrivo_plan_basic_eur_year")).toMatchObject({ unit_amount: 2_490_00, tax_behavior: "exclusive" });
  });

  it("[M01.main] the workspace comes from app.billing_context, never from the request", async () => {
    // The context names WS whatever the form was posted for: a mismatch is an error and nothing reaches Stripe.
    context = ctx({ workspace_id: OTHER });
    expect(await startCheckout(WS, { plan: "standard", term: "monthly" })).toEqual({ ok: false, reason: "error" });
    expect(fake.requests).toHaveLength(0);
    // Below an internal, unscoped admin the database refuses (42501), and nothing reaches Stripe.
    context = { data: null, error: { code: "42501", message: "only an internal admin" } };
    expect(await startCheckout(WS, { plan: "standard", term: "monthly" })).toEqual({ ok: false, reason: "no-permission" });
    expect(fake.requests).toHaveLength(0);
  });

  it("[M01.main] a second checkout reuses the workspace's customer instead of creating another", async () => {
    await redirectOf(startCheckout(WS, { plan: "standard", term: "monthly" }));
    await redirectOf(startCheckout(WS, { plan: "basic", term: "monthly" }));
    expect(fake.customers.size).toBe(1);
  });

  it("[M01.main] Advanced is quoted, a plan outside the catalogue is refused, and a live key is never used", async () => {
    expect(await startCheckout(WS, { plan: "advanced", term: "monthly" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await startCheckout(WS, { plan: "gold", term: "monthly" })).toMatchObject({ ok: false, reason: "invalid" });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_never");
    expect(await startCheckout(WS, { plan: "standard", term: "monthly" })).toEqual({ ok: false, reason: "not-configured" });
  });

  it("[M05.main] Cancel, downgrade or suspend: a live subscription changes through the customer portal, never a second checkout", async () => {
    const cust = { id: "cus_live", object: "customer", name: "Halden", metadata: { workspace_id: WS }, tax_ids: [], invoice_settings: {}, address: null };
    fake.customers.set(cust.id, cust);
    context = ctx({ plan: "standard", stripe_customer_id: "cus_live", stripe_subscription_id: "sub_live", subscription_status: "active", term: "monthly" });
    expect(await startCheckout(WS, { plan: "basic", term: "monthly" })).toEqual({ ok: false, reason: "live" });
    const url = await redirectOf(openPortal(WS, "subscription_update"));
    expect(url).toBe("http://fake-stripe.test/portal/cus_live");
    const session = fake.portalSessions[0];
    expect(session.customer).toBe("cus_live");
    expect(session.return_url).toBe(`https://app.nutrivo.test/w/${WS}/settings/billing`);
    expect(session.flow_data).toMatchObject({ type: "subscription_update", subscription_update: { subscription: "sub_live" } });
    // Cancelling ends at the period's end and asks no reason; a downgrade waits for the renewal.
    const features = fake.portalConfigs[0].features as Json;
    expect(features.subscription_cancel).toMatchObject({ enabled: "true", mode: "at_period_end", cancellation_reason: { enabled: "false" } });
    expect((features.subscription_update as Json).schedule_at_period_end).toMatchObject({ conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }] });
    // The configuration is made once and found again.
    await redirectOf(openPortal(WS, "subscription_cancel"));
    expect(fake.portalConfigs).toHaveLength(1);
  });

  it("[M05.main] a customer that names another workspace is never used", async () => {
    const cust = { id: "cus_other", object: "customer", name: "B", metadata: { workspace_id: OTHER }, tax_ids: [], invoice_settings: {}, address: null };
    fake.customers.set(cust.id, cust);
    context = ctx({ stripe_customer_id: "cus_other" });
    expect(await openPortal(WS, "payment_method_update")).toEqual({ ok: false, reason: "error" });
    expect(fake.portalSessions).toHaveLength(0);
  });

  it("[M03.main] billing details are saved on the Stripe customer, with the VAT number Stripe validates", async () => {
    const r = await saveBillingDetails(WS, {
      legalName: "Bergmann Tiernahrung GmbH", line1: "Hafenstraße 12", line2: "", postalCode: "20457", city: "Hamburg",
      country: "DE", vat: "de 123 456 789", companyId: "HRB 1234", poReference: "PO-7781",
    });
    expect(r).toEqual({ ok: true });
    const cust = [...fake.customers.values()][0];
    expect(cust.name).toBe("Bergmann Tiernahrung GmbH");
    expect(cust.address).toMatchObject({ country: "DE", city: "Hamburg", postal_code: "20457" });
    expect(cust.tax_ids).toMatchObject([{ type: "eu_vat", value: "DE123456789" }]);
    expect(cust.invoice_settings.custom_fields).toEqual([{ name: "PO reference", value: "PO-7781" }]);
    expect(cust.metadata).toMatchObject({ workspace_id: WS, company_id: "HRB 1234" });
    // A VAT number for another country than the address is refused before Stripe is called.
    const before = fake.requests.length;
    expect(await saveBillingDetails(WS, { legalName: "X", line1: "Y", line2: "", postalCode: "1", city: "Z", country: "DE", vat: "SE556734112801", companyId: "", poReference: "" })).toMatchObject({ ok: false, reason: "invalid", problem: "vat" });
    expect(fake.requests.length).toBe(before);
  });
  it("[M02.main] Checkout charges the add-ons that cover the counts, and refuses a plan past its ceiling (BE-34)", async () => {
    // Twelve recipes and four editors on Basic: two recipes at €15 and one seat at €50 on top of €249 (€329 ≤ €374).
    counts = { recipes: 12, regions: ["EU"], editor_seats: 4, labels_used: 3, labels_allowed: 3 };
    await redirectOf(startCheckout(WS, { plan: "basic", term: "monthly" }));
    expect(sessionParams().line_items).toEqual([
      { price: "price_nutrivo_plan_basic_eur_month", quantity: "1" },
      { price: "price_nutrivo_addon_recipe_basic_eur_month", quantity: "2" },
      { price: "price_nutrivo_addon_editor_seat_basic_eur_month", quantity: "1" },
    ]);
    // Nineteen recipes would pass €374 on Basic: refused before Stripe opens a session.
    counts = { recipes: 19, regions: ["EU"], editor_seats: 1, labels_used: 3, labels_allowed: 3 };
    const before = fake.sessions.size;
    expect(await startCheckout(WS, { plan: "basic", term: "monthly" })).toEqual({ ok: false, reason: "invalid", problem: "does_not_fit" });
    expect(fake.sessions.size).toBe(before);
  });

  it("[M01.main] one payment per workspace: an open session for the same order is reused, another is expired, a paid one refuses", async () => {
    const first = await redirectOf(startCheckout(WS, { plan: "standard", term: "monthly" }));
    const again = await redirectOf(startCheckout(WS, { plan: "standard", term: "monthly" }));
    expect(again).toBe(first);
    expect(fake.sessions.size).toBe(1);
    // A different order (annual) expires the open monthly session before opening its own.
    const annual = await redirectOf(startCheckout(WS, { plan: "standard", term: "annual" }));
    expect(annual).not.toBe(first);
    const statuses = [...fake.sessions.values()].map((x) => x.status);
    expect(statuses).toEqual(["expired", "open"]);
    // Every create carries an idempotency key for the order.
    expect(fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/checkout/sessions").every((r) => r.idempotencyKey?.startsWith(`nutrivo-checkout-${WS}-`))).toBe(true);
    // Paid, and the webhook has not applied it yet: no second session.
    const open = [...fake.sessions.values()].find((x) => x.status === "open")!;
    const cust = [...fake.customers.values()][0];
    cust.address = { line1: "Industrivägen 4", line2: null, postal_code: "412 63", city: "Göteborg", country: "SE" };
    fake.pay(String(open.id), { name: "Halden Pet Nutrition AB", address: cust.address as Json });
    expect(await startCheckout(WS, { plan: "standard", term: "annual" })).toEqual({ ok: false, reason: "live", problem: "applying" });
  });

  it("[M03.main] a change to the billing details is audited with what it was and what it is", async () => {
    await saveBillingDetails(WS, { legalName: "Halden Pet Nutrition AB", line1: "Industrivägen 4", line2: "", postalCode: "412 63", city: "Göteborg", country: "SE", vat: "", companyId: "", poReference: "" });
    const r = await saveBillingDetails(WS, { legalName: "Halden Pet Nutrition AB", line1: "Industrivägen 4", line2: "", postalCode: "412 63", city: "Göteborg", country: "SE", vat: "SE556734112801", companyId: "556734-1128", poReference: "" });
    expect(r).toEqual({ ok: true });
    const calls = rpc.mock.calls.filter((c) => c[0] === "record_billing_change");
    expect(calls).toHaveLength(2);
    const last = calls[1][1] as Json;
    expect(last).toMatchObject({ p_ws: WS, p_kind: "details", p_customer: [...fake.customers.keys()][0] });
    expect(last.p_before).toMatchObject({ vat_number: null, company_id: "" });
    expect(last.p_after).toMatchObject({ vat_number: "SE556734112801", company_id: "556734-1128", legal_name: "Halden Pet Nutrition AB" });
    // When the audit row cannot be written the person is told, never passed over in silence.
    audited = { data: null, error: { code: "XX000", message: "down" } };
    expect(await saveFinanceEmail(WS, "ekonomi@halden.test")).toEqual({ ok: false, reason: "error", problem: "audit" });
    expect(rpc.mock.calls.filter((c) => c[0] === "record_billing_change").at(-1)![1]).toMatchObject({ p_kind: "finance_email", p_after: { email: "ekonomi@halden.test" } });
  });
});
