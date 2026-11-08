import "server-only";

// What every billing page does first (T-703): the billing context under the person's session (internal, unscoped
// admins only) and, when it is refused, the workspace's name for the no-permission state.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { billingContext, type BillingContext } from "./context";

export type Gate = { ok: true; ctx: BillingContext } | { ok: false; workspace: string };

export async function billingGate(supabase: SupabaseClient<Database>, ws: string): Promise<Gate> {
  const c = await billingContext(supabase, ws);
  if (c.ok) return c;
  if (c.reason !== "no-permission") throw new Error(`billing context failed: ${c.code ?? "error"}`);
  const { data } = await supabase.schema("app").from("workspaces").select("name").eq("id", ws).maybeSingle();
  return { ok: false, workspace: data?.name ?? "this workspace" };
}
