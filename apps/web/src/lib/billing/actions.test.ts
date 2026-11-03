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
let context: { data: Json | null; error: { code: string; message: string } | null };
const rpc = vi.fn(async (...call: unknown[]) => {
  void call;
  return context;
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ schema: () => ({ rpc }) }) }));

const ctx = (over: Json = {}) => ({
  data: { workspace_id: WS, name: "Halden Pet Nutrition", plan: "free", status: "active", stripe_customer_id: null,
    stripe_subscription_id: null, subscription_status: null, term: null, current_period_end: null, ...over },
  error: null,
});

let fake: FakeStripe;
const { startCheckout, openPortal, saveBillingDetails } = await import("./actions");

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
    expect(p.success_url).toBe(`https://app.nutrivo.test/w/${WS}/billing/invoices/{CHECKOUT_SESSION_ID}`);
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
});
