import "server-only";

// T-703: what the billing screens read. Database reads are under the admin's own session (RLS): the live counts
// (app.live_billable_counts, at request time, never cached: M02.must.1), the subscription mirror, checks run and the
// stored invoice events. Stripe reads (the customer's billing details, card and an exact VAT preview) start from the
// billing context, so they only ever name the caller's own workspace's customer.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { billingContext, workspaceCustomer, type BillingContext } from "./context";
import { invoicesFrom, readInvoice, treatmentOf, type Invoice, type PaymentEventRow, type Treatment } from "./invoices";
import { extrasFor, INTERVAL, readCounts, type LiveCounts, type Term } from "./plans";
import { stripe, type Address, type Customer, type PaymentMethod, type Price } from "./stripe";
import type { PaidPlanKey } from "../../../../../config/pricing";

type Client = SupabaseClient<Database>;

export class BillingReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read ${what}: ${cause.code ?? "error"} ${cause.message}`);
    this.name = "BillingReadError";
  }
}

export type Subscription = {
  plan: string;
  term: Term | null;
  status: string;
  editorSeats: number | null;
  recipesIncluded: number | null;
  currentPeriodEnd: string | null;
};

export type Usage = {
  counts: LiveCounts;
  /** The mirror, or null when the workspace has never subscribed (D-21: the free allowance has no row). */
  subscription: Subscription | null;
  /** app.workspaces.plan and status. */
  plan: string;
  status: string;
  /** Rows of app.checks the admin can read (decision 5 on #64): shown, never metered. */
  checksRun: number;
};

/**
 * Everything the dials need, read now (M02.must.1: counts are read at request time, never nightly). "Checks run" is
 * the number of app.checks rows the admin reads under RLS, one per market and language panel checked.
 */
export async function readUsage(supabase: Client, ws: string): Promise<Usage> {
  const app = supabase.schema("app");
  const [counts, sub, wsRow, checks] = await Promise.all([
    app.rpc("live_billable_counts", { p_ws: ws }),
    app.from("subscriptions").select("plan, term, status, editor_seats, recipes_included, current_period_end").eq("workspace_id", ws).maybeSingle(),
    app.from("workspaces").select("plan, status").eq("id", ws).maybeSingle(),
    app.from("checks").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
  ]);
  if (counts.error) throw new BillingReadError("live billable counts", counts.error);
  if (sub.error) throw new BillingReadError("the subscription", sub.error);
  if (wsRow.error) throw new BillingReadError("the workspace", wsRow.error);
  const live = readCounts(counts.data);
  if (!live) throw new BillingReadError("live billable counts", { message: "not a member" });
  const s = sub.data;
  return {
    counts: live,
    subscription: s
      ? {
          plan: s.plan,
          term: s.term === "monthly" || s.term === "annual" ? s.term : null,
          status: s.status,
          editorSeats: s.editor_seats,
          recipesIncluded: s.recipes_included,
          currentPeriodEnd: s.current_period_end,
        }
      : null,
    plan: wsRow.data?.plan ?? "free",
    status: wsRow.data?.status ?? "active",
    checksRun: checks.error ? 0 : (checks.count ?? 0),
  };
}

/** The workspace's invoices as Stripe issued them, from the stored invoice events (admins only, RLS). */
export async function readInvoices(supabase: Client, ws: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .schema("app")
    .from("payment_events")
    .select("stripe_event_id, type, payload, received_at")
    .eq("workspace_id", ws)
    .in("type", ["invoice.paid", "invoice.payment_failed"])
    .order("received_at", { ascending: false })
    .limit(500);
  if (error) throw new BillingReadError("invoices", error);
  return invoicesFrom((data ?? []) as PaymentEventRow[]);
}

/** S-PLN-003 by Stripe invoice id (`in_…`), only among this workspace's stored invoice events. */
export async function readInvoiceById(supabase: Client, ws: string, id: string): Promise<Invoice | null> {
  if (!/^in_[A-Za-z0-9_]{1,250}$/.test(id)) return null;
  return (await readInvoices(supabase, ws)).find((i) => i.id === id) ?? null;
}

export type BillingDetails = {
  customerId: string | null;
  legalName: string;
  address: Address;
  vat: { value: string; status: "pending" | "verified" | "unverified" | "unavailable" | null } | null;
  companyId: string;
  poReference: string;
  financeEmail: string;
};

export const PO_FIELD = "PO reference";

const EMPTY_ADDRESS: Address = { line1: null, line2: null, postal_code: null, city: null, country: null };

export function detailsOf(c: Customer | null): BillingDetails {
  const tax = c?.tax_ids?.data?.[0] ?? null;
  return {
    customerId: c?.id ?? null,
    legalName: c?.name ?? "",
    address: c?.address ?? EMPTY_ADDRESS,
    vat: tax ? { value: tax.value, status: tax.verification?.status ?? null } : null,
    companyId: c?.metadata?.company_id ?? "",
    poReference: c?.invoice_settings?.custom_fields?.find((f) => f.name === PO_FIELD)?.value ?? "",
    financeEmail: c?.email ?? "",
  };
}

/** The Stripe customer's billing details, read now: Stripe is where they live (D-18). */
export async function readDetails(ctx: BillingContext): Promise<BillingDetails> {
  return detailsOf(await workspaceCustomer(ctx, { create: false }));
}

export type CardOnFile = { brand: string; last4: string; expMonth: number; expYear: number; name: string | null; primary: boolean };

/** The cards on file, the default first. Nothing is stored in Nutrivo: Stripe holds them. */
export async function readCards(ctx: BillingContext): Promise<CardOnFile[]> {
  const c = await workspaceCustomer(ctx, { create: false });
  if (!c) return [];
  const def = c.invoice_settings?.default_payment_method;
  const defId = typeof def === "string" ? def : (def?.id ?? null);
  const list = await stripe<{ data: PaymentMethod[] }>("GET", `/v1/customers/${encodeURIComponent(c.id)}/payment_methods`, { type: "card", limit: 5 });
  const cards = list.data
    .filter((pm) => pm.card)
    .map((pm) => ({
      brand: pm.card!.brand,
      last4: pm.card!.last4,
      expMonth: pm.card!.exp_month,
      expYear: pm.card!.exp_year,
      name: pm.billing_details?.name ?? null,
      primary: pm.id === defId,
    }));
  if (cards.length && !cards.some((k) => k.primary)) cards[0].primary = true;
  return cards.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** A price by its catalogue lookup key (docs/08: code reads prices by lookup key, never by id). */
export async function priceByKey(lookupKey: string): Promise<Price | null> {
  const r = await stripe<{ data: Price[] }>("GET", "/v1/prices", { "lookup_keys[]": lookupKey, active: true, limit: 1 });
  return r.data[0] ?? null;
}

export const planLookupKey = (plan: PaidPlanKey, term: Term) => `nutrivo_plan_${plan}_eur_${INTERVAL[term]}`;

export type CheckoutItem = { lookupKey: string; quantity: number };

/**
 * The line items a Checkout for this plan charges (docs/08 "Stripe mapping"): the plan, then the recipe and editor-seat
 * add-ons that cover the workspace's counts beyond what the plan includes. The worker reads them back into the
 * mirror's recipes and seats (T-702). Only for a plan that fits (BE-34); the caller checks.
 */
export function checkoutItems(plan: PaidPlanKey, term: Term, counts: LiveCounts): CheckoutItem[] {
  const interval = INTERVAL[term];
  const extra = extrasFor(plan, counts);
  const items: CheckoutItem[] = [{ lookupKey: planLookupKey(plan, term), quantity: 1 }];
  if (extra.recipes) items.push({ lookupKey: `nutrivo_addon_recipe_${plan}_eur_${interval}`, quantity: extra.recipes });
  if (extra.editorSeats) items.push({ lookupKey: `nutrivo_addon_editor_seat_${plan}_eur_${interval}`, quantity: extra.editorSeats });
  return items;
}

/** The items with their Stripe price ids, by lookup key; null when one is not in the catalogue. */
export async function resolveItems(items: CheckoutItem[]): Promise<{ price: string; quantity: number }[] | null> {
  const prices = await Promise.all(items.map((i) => priceByKey(i.lookupKey)));
  if (prices.some((p) => !p)) return null;
  return items.map((i, n) => ({ price: prices[n]!.id, quantity: i.quantity }));
}

export type TaxPreview = { subtotal: number; tax: number; total: number; treatment: Treatment; rate: number | null; country: string | null };

/**
 * The exact first invoice Stripe Tax would issue for this customer, when the customer already has a billing address.
 * Without one there is nothing to compute VAT from, and the screen says it is added at payment. Never throws: a
 * preview that fails is simply not shown.
 */
export async function previewFirstInvoice(ctx: BillingContext, items: CheckoutItem[]): Promise<TaxPreview | null> {
  try {
    const c = await workspaceCustomer(ctx, { create: false });
    if (!c?.address?.country) return null;
    const resolved = await resolveItems(items);
    if (!resolved) return null;
    const inv = await stripe<Record<string, unknown>>("POST", "/v1/invoices/create_preview", {
      customer: c.id,
      automatic_tax: { enabled: true },
      subscription_details: { items: resolved },
    });
    const read = readInvoice({ object: "invoice", id: "in_preview", ...inv, customer_address: inv.customer_address ?? c.address });
    if (!read) return null;
    const { treatment, rate } = treatmentOf({ ...inv, customer_address: inv.customer_address ?? c.address });
    return { subtotal: read.subtotal, tax: read.tax, total: read.total, treatment, rate, country: c.address.country };
  } catch {
    return null;
  }
}

export { billingContext };
