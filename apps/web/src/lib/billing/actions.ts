"use server";

// T-703 · M01, M03, M05: the billing writes, as Server Actions under the admin's own session. None writes the
// database: Stripe is the source of truth (D-18) and its events come back through stripe-webhook (T-702), which
// stores, audits and applies them. Each action starts from app.billing_context, so the workspace and the Stripe
// customer are the caller's own, checked in the database (internal, unscoped admins only), never taken from the form.
// A failure goes to Sentry by its code with the request id, never with what was typed (docs/17).
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { hrefFor } from "@/lib/shell/routes";
import { billingContext, workspaceCustomer, type BillingContext } from "./context";
import { isLive, isPaidPlan, isTerm, type Term } from "./plans";
import { PO_FIELD, planLookupKey, priceByKey } from "./read";
import { stripe, StripeConfigError, StripeError, type Customer, type TaxId } from "./stripe";
import { checkDetails, taxIdType, type DetailsInput } from "./rules";
import type { PaidPlanKey } from "../../../../../config/pricing";

export type Refusal =
  | "no-permission" // 42501 from app.billing_context
  | "live" // a live subscription changes plan in the portal, never with a second checkout
  | "no-customer" // nothing to open a portal for yet
  | "invalid" // refused before Stripe was called, or Stripe refused the value (a VAT number, say)
  | "not-configured" // the Stripe key is missing or not a test key outside prod
  | "error";

export type Result = { ok: true } | { ok: false; reason: Refusal; problem?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The site's own origin for Stripe's return URLs: APP_BASE_URL where set (staging, prod), else this request's. */
async function origin(): Promise<string> {
  const base = process.env.APP_BASE_URL;
  if (base) return base.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Runs one billing action with the request id on the Sentry scope; Stripe and configuration failures are mapped. */
async function run(name: string, ws: string, body: (ctx: BillingContext) => Promise<Result | string>): Promise<Result> {
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  if (!UUID.test(ws)) return { ok: false, reason: "invalid" };
  let target: string | null = null;
  const result = await Sentry.withScope(async (scope): Promise<Result> => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "billing");
    scope.setTag("billing.action", name);
    const supabase = await createClient();
    const c = await billingContext(supabase, ws);
    if (!c.ok) {
      if (c.reason === "error") Sentry.captureException(new Error(`billing_context failed: ${c.code ?? "error"}`));
      return { ok: false, reason: c.reason };
    }
    try {
      const out = await body(c.ctx);
      if (typeof out === "string") {
        target = out;
        return { ok: true };
      }
      return out;
    } catch (e) {
      if (e instanceof StripeConfigError) {
        Sentry.captureException(new Error(`${name}: stripe not configured`));
        return { ok: false, reason: "not-configured" };
      }
      if (e instanceof StripeError) {
        if (e.status === 400 && e.code && /tax_id|postal|address|email/.test(e.code)) return { ok: false, reason: "invalid", problem: e.code };
        Sentry.captureException(new Error(`${name}: stripe ${e.status} ${e.type} ${e.code ?? ""}`.trim()));
        return { ok: false, reason: "error" };
      }
      Sentry.captureException(e);
      return { ok: false, reason: "error" };
    }
  });
  // redirect() throws to unwind, so it runs outside the scope and the try above.
  if (target) redirect(target);
  return result;
}

export type CheckoutInput = { plan: string; term: string; poReference?: string };

/**
 * M01: Stripe-hosted Checkout for a workspace with no live subscription. Automatic tax and tax-ID collection
 * (BE-35: prices are net and VAT is added on the invoice); the billing address is required, so Stripe Tax can decide
 * Swedish VAT, the reverse charge, the one-stop shop or none. The session names the workspace twice
 * (`client_reference_id`, `subscription_data.metadata.workspace_id`) from the billing context, and the customer is
 * the workspace's own, so the webhook attributes the subscription to this workspace and no other.
 */
export async function startCheckout(ws: string, input: CheckoutInput): Promise<Result> {
  return run("start_checkout", ws, async (ctx) => {
    const { plan, term } = input;
    if (!isPaidPlan(plan) || !isTerm(term)) return { ok: false, reason: "invalid" };
    if (plan === "advanced") return { ok: false, reason: "invalid", problem: "advanced_is_quoted" };
    if (isLive(ctx.subscriptionStatus)) return { ok: false, reason: "live" };
    const po = (input.poReference ?? "").trim();
    if (po.length > 30) return { ok: false, reason: "invalid", problem: "po_too_long" };
    const price = await priceByKey(planLookupKey(plan, term));
    if (!price) {
      Sentry.captureException(new Error(`start_checkout: no active price ${planLookupKey(plan, term)}`));
      return { ok: false, reason: "error" };
    }
    const customer = await workspaceCustomer(ctx, { create: true });
    if (!customer) return { ok: false, reason: "error" };
    if (po || customer.invoice_settings?.custom_fields?.some((f) => f.name === PO_FIELD)) {
      await stripe<Customer>("POST", `/v1/customers/${encodeURIComponent(customer.id)}`, { invoice_settings: { custom_fields: customFields(customer, po) } });
    }
    const base = await origin();
    const session = await stripe<{ url: string }>("POST", "/v1/checkout/sessions", {
      mode: "subscription",
      customer: customer.id,
      client_reference_id: ctx.workspaceId,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { metadata: { workspace_id: ctx.workspaceId } },
      metadata: { workspace_id: ctx.workspaceId, nutrivo_plan: plan, nutrivo_term: term },
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "required",
      success_url: `${base}${hrefFor("/w/[workspace]/billing/invoices/[invoice]", ctx.workspaceId).replace("[invoice]", "{CHECKOUT_SESSION_ID}")}`,
      cancel_url: `${base}${hrefFor("/w/[workspace]/billing/checkout", ctx.workspaceId)}?plan=${plan}&term=${term}`,
    });
    return session.url;
  });
}

function customFields(c: Customer, po: string): { name: string; value: string }[] | "" {
  const others = (c.invoice_settings?.custom_fields ?? []).filter((f) => f.name !== PO_FIELD);
  const fields = po ? [...others, { name: PO_FIELD, value: po }] : others;
  // Stripe clears the list with an empty string.
  return fields.length ? fields : "";
}

export type PortalFlow = "home" | "payment_method_update" | "subscription_update" | "subscription_cancel";

/**
 * M05: the Stripe customer portal for cards, plan changes, cancellation and invoices. The workspace status follows
 * through the webhook (T-702). A downgrade takes effect at the next renewal and a cancellation at the end of the
 * period, with no form asking why (design: "Downgrading is the same three clicks").
 */
export async function openPortal(ws: string, flow: PortalFlow, returnTo: "billing" | "payment" | "invoices" = "billing"): Promise<Result> {
  return run("open_portal", ws, async (ctx) => {
    const customer = await workspaceCustomer(ctx, { create: false });
    if (!customer) return { ok: false, reason: "no-customer" };
    if ((flow === "subscription_update" || flow === "subscription_cancel") && (!ctx.stripeSubscriptionId || !isLive(ctx.subscriptionStatus))) {
      return { ok: false, reason: "invalid" };
    }
    const configuration = await portalConfiguration();
    const back = { billing: "/w/[workspace]/settings/billing", payment: "/w/[workspace]/settings/billing/payment", invoices: "/w/[workspace]/settings/billing/invoices" } as const;
    const returnUrl = `${await origin()}${hrefFor(back[returnTo], ctx.workspaceId)}`;
    const flowData =
      flow === "payment_method_update"
        ? { type: "payment_method_update" }
        : flow === "subscription_update"
          ? { type: "subscription_update", subscription_update: { subscription: ctx.stripeSubscriptionId } }
          : flow === "subscription_cancel"
            ? { type: "subscription_cancel", subscription_cancel: { subscription: ctx.stripeSubscriptionId } }
            : null;
    const session = await stripe<{ url: string }>("POST", "/v1/billing_portal/sessions", {
      customer: customer.id,
      configuration,
      return_url: returnUrl,
      flow_data: flowData ? { ...flowData, after_completion: { type: "redirect", redirect: { return_url: returnUrl } } } : null,
    });
    return session.url;
  });
}

const PORTAL_MARK = "portal-v1";

/**
 * The portal's configuration, made once and found again by its metadata (a re-run changes nothing). Plans switch
 * between Basic and Standard (Advanced is quoted, so it is reached by talking to us); a downgrade waits for the
 * next renewal; cancelling ends at the period's end and asks no reason; customers may change their address, name
 * and VAT number, which Stripe validates.
 */
async function portalConfiguration(): Promise<string> {
  const list = await stripe<{ data: { id: string; active: boolean; metadata: Record<string, string> }[] }>("GET", "/v1/billing_portal/configurations", { active: true, limit: 100 });
  const found = list.data.find((c) => c.active && c.metadata?.nutrivo === PORTAL_MARK);
  if (found) return found.id;
  const plans: PaidPlanKey[] = ["basic", "standard"];
  const products = await Promise.all(
    plans.map(async (p) => {
      const prices = await Promise.all((["monthly", "annual"] as Term[]).map((t) => priceByKey(planLookupKey(p, t))));
      return { product: `nutrivo_plan_${p}`, prices: prices.filter((x) => !!x).map((x) => x!.id) };
    }),
  );
  const made = await stripe<{ id: string }>(
    "POST",
    "/v1/billing_portal/configurations",
    {
      metadata: { nutrivo: PORTAL_MARK },
      business_profile: { headline: "Nutrivo.ai · Sunny Ventures AB" },
      features: {
        customer_update: { enabled: true, allowed_updates: ["address", "name", "tax_id", "email"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: false } },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          products: products.filter((p) => p.prices.length),
          schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }] },
        },
      },
    },
    { idempotencyKey: `nutrivo-${PORTAL_MARK}` },
  );
  return made.id;
}

/**
 * M03: the billing details on the Stripe customer: legal name, registered address, VAT number (Stripe validates it
 * against VIES), company ID and the PO reference printed on every invoice. Stripe Tax uses the country and the VAT
 * number to choose Swedish VAT, the reverse charge, the one-stop shop or none.
 */
export async function saveBillingDetails(ws: string, input: DetailsInput): Promise<Result> {
  const checked = checkDetails(input);
  if (!checked.ok) return { ok: false, reason: "invalid", problem: checked.problem };
  const d = checked.value;
  return run("save_billing_details", ws, async (ctx) => {
    const customer = await workspaceCustomer(ctx, { create: true });
    if (!customer) return { ok: false, reason: "error" };
    const metadata = { ...customer.metadata, workspace_id: ctx.workspaceId, company_id: d.companyId };
    await stripe<Customer>("POST", `/v1/customers/${encodeURIComponent(customer.id)}`, {
      name: d.legalName,
      address: { line1: d.line1, line2: d.line2 ?? "", postal_code: d.postalCode, city: d.city, country: d.country },
      metadata,
      invoice_settings: { custom_fields: customFields(customer, d.poReference) },
    });
    const current: TaxId[] = customer.tax_ids?.data ?? [];
    const wanted = d.vat ? { type: taxIdType(d.country), value: d.vat } : null;
    const keep = wanted ? current.find((t) => t.value.replace(/\s/g, "").toUpperCase() === wanted.value && t.type === wanted.type) : undefined;
    if (wanted && !keep) {
      if (!wanted.type) return { ok: false, reason: "invalid", problem: "vat_country" };
      await stripe("POST", `/v1/customers/${encodeURIComponent(customer.id)}/tax_ids`, { type: wanted.type, value: wanted.value });
    }
    for (const t of current) {
      if (t !== keep) await stripe("DELETE", `/v1/customers/${encodeURIComponent(customer.id)}/tax_ids/${encodeURIComponent(t.id)}`);
    }
    return { ok: true };
  });
}

/** S-BIL-002: the finance address that receives every invoice (the Stripe customer's email). Not a seat. */
export async function saveFinanceEmail(ws: string, email: string): Promise<Result> {
  const value = email.trim();
  if (value && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254)) return { ok: false, reason: "invalid", problem: "email" };
  return run("save_finance_email", ws, async (ctx) => {
    const customer = await workspaceCustomer(ctx, { create: true });
    if (!customer) return { ok: false, reason: "error" };
    await stripe<Customer>("POST", `/v1/customers/${encodeURIComponent(customer.id)}`, { email: value || "" });
    return { ok: true };
  });
}
