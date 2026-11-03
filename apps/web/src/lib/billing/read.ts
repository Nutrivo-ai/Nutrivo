import "server-only";

// T-703: what the billing screens read. Database reads are under the admin's own session (RLS): the live counts
// (app.live_billable_counts, at request time, never cached: M02.must.1), the subscription mirror, checks run and the
// stored invoice events. Stripe reads (the customer's billing details, card and an exact VAT preview) start from the
// billing context, so they only ever name the caller's own workspace's customer.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { billingContext, workspaceCustomer, type BillingContext } from "./context";
import { invoicesFrom, readInvoice, treatmentOf, type Invoice, type PaymentEventRow, type Treatment } from "./invoices";
import { INTERVAL, readCounts, type LiveCounts, type Term } from "./plans";
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
  /** Check and re-check jobs that finished: shown, never metered. */
  checksRun: number;
};

/** Everything the dials need, read now (M02.must.1: counts are read at request time, never nightly). */
export async function readUsage(supabase: Client, ws: string): Promise<Usage> {
  const app = supabase.schema("app");
  const [counts, sub, wsRow, checks] = await Promise.all([
    app.rpc("live_billable_counts", { p_ws: ws }),
    app.from("subscriptions").select("plan, term, status, editor_seats, recipes_included, current_period_end").eq("workspace_id", ws).maybeSingle(),
    app.from("workspaces").select("plan, status").eq("id", ws).maybeSingle(),
    app.from("jobs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).in("kind", ["check", "recheck"]).eq("status", "succeeded"),
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

export type CheckoutReturn =
  | { kind: "invoice"; invoice: Invoice }
  /** Paid, and Stripe has not sent the invoice yet: the screen waits for it. */
  | { kind: "pending"; plan: string | null }
  /** Not this workspace's session, unpaid, or unknown. */
  | { kind: "unknown" };

/**
 * S-PLN-003 by id. An invoice id (`in_…`) is read from the stored events; a Checkout Session id (`cs_…`), which is where
 * Checkout returns to, is resolved through Stripe to its invoice, and only when the session is this workspace's.
 */
export async function readInvoiceOrReturn(supabase: Client, ctx: BillingContext, id: string): Promise<CheckoutReturn> {
  if (/^cs_[A-Za-z0-9_]{1,250}$/.test(id)) {
    const session = await stripe<{ client_reference_id: string | null; status: string; payment_status: string; invoice: string | null; metadata?: Record<string, string> }>(
      "GET",
      `/v1/checkout/sessions/${encodeURIComponent(id)}`,
    );
    if (session.client_reference_id !== ctx.workspaceId || session.status !== "complete") return { kind: "unknown" };
    if (!session.invoice) return { kind: "pending", plan: session.metadata?.nutrivo_plan ?? null };
    id = session.invoice;
  }
  if (!/^in_[A-Za-z0-9_]{1,250}$/.test(id)) return { kind: "unknown" };
  const invoices = await readInvoices(supabase, ctx.workspaceId);
  const hit = invoices.find((i) => i.id === id);
  return hit ? { kind: "invoice", invoice: hit } : { kind: "pending", plan: null };
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

export type TaxPreview = { subtotal: number; tax: number; total: number; treatment: Treatment; rate: number | null; country: string | null };

/**
 * The exact first invoice Stripe Tax would issue for this customer, when the customer already has a billing address.
 * Without one there is nothing to compute VAT from, and the screen says it is added at payment. Never throws: a
 * preview that fails is simply not shown.
 */
export async function previewFirstInvoice(ctx: BillingContext, plan: PaidPlanKey, term: Term): Promise<TaxPreview | null> {
  try {
    const c = await workspaceCustomer(ctx, { create: false });
    if (!c?.address?.country) return null;
    const price = await priceByKey(planLookupKey(plan, term));
    if (!price) return null;
    const inv = await stripe<Record<string, unknown>>("POST", "/v1/invoices/create_preview", {
      customer: c.id,
      automatic_tax: { enabled: true },
      subscription_details: { items: [{ price: price.id, quantity: 1 }] },
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
