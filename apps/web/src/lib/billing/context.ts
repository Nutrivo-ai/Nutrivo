import "server-only";

// T-703: the billing context (app.billing_context), read under the admin's own session. Every Stripe call the web
// server makes for a workspace starts here: the workspace id and the Stripe customer come from the database, checked
// against auth.uid() (internal, unscoped admins only), never from the request (docs/08 "Checkout contract").
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { stripe, StripeError, type Customer } from "./stripe";

export type BillingContext = {
  workspaceId: string;
  name: string;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  term: string | null;
  currentPeriodEnd: string | null;
};

export type ContextResult = { ok: true; ctx: BillingContext } | { ok: false; reason: "no-permission" | "error"; code?: string };

const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function billingContext(supabase: SupabaseClient<Database>, ws: string): Promise<ContextResult> {
  const { data, error } = await supabase.schema("app").rpc("billing_context", { p_ws: ws });
  if (error) return { ok: false, reason: error.code === "42501" ? "no-permission" : "error", code: error.code };
  const r = (data ?? {}) as Record<string, unknown>;
  const workspaceId = s(r.workspace_id);
  if (!workspaceId || workspaceId !== ws) return { ok: false, reason: "error", code: "no_context" };
  return {
    ok: true,
    ctx: {
      workspaceId,
      name: s(r.name) ?? "",
      plan: s(r.plan) ?? "free",
      status: s(r.status) ?? "active",
      stripeCustomerId: s(r.stripe_customer_id),
      stripeSubscriptionId: s(r.stripe_subscription_id),
      subscriptionStatus: s(r.subscription_status),
      term: s(r.term),
      currentPeriodEnd: s(r.current_period_end),
    },
  };
}

const EXPAND = { expand: ["tax_ids", "invoice_settings.default_payment_method"] };

/**
 * The workspace's Stripe customer. The mirrored one wins (app.subscriptions); before the first subscription it is the
 * customer the web server created for the workspace, found by `metadata.workspace_id` (only this server, holding the
 * secret key, writes that metadata). With `create`, a workspace that has none gets one, under an idempotency key so
 * a double submit never makes two. A customer whose metadata names another workspace is never used.
 */
export async function workspaceCustomer(ctx: BillingContext, opts: { create: boolean }): Promise<Customer | null> {
  if (ctx.stripeCustomerId) {
    const c = await stripe<Customer>("GET", `/v1/customers/${encodeURIComponent(ctx.stripeCustomerId)}`, EXPAND);
    if (c.deleted) return null;
    const owner = c.metadata?.workspace_id;
    if (owner && owner !== ctx.workspaceId) throw new StripeError(409, "invalid_request_error", "customer_workspace_mismatch", "customer names another workspace");
    return c;
  }
  const found = await stripe<{ data: Customer[] }>("GET", "/v1/customers/search", {
    query: `metadata['workspace_id']:'${ctx.workspaceId}'`,
    limit: 1,
    expand: EXPAND.expand.map((e) => `data.${e}`),
  });
  const hit = found.data.find((c) => !c.deleted && c.metadata?.workspace_id === ctx.workspaceId);
  if (hit) return hit;
  if (!opts.create) return null;
  return stripe<Customer>(
    "POST",
    "/v1/customers",
    { name: ctx.name || null, metadata: { workspace_id: ctx.workspaceId }, ...EXPAND },
    { idempotencyKey: `nutrivo-customer-${ctx.workspaceId}` },
  );
}
