// T-401 reads for Add a product (S-NV2-022), Discontinued (S-NV2-023) and the allowance moments on Upload & scope
// (S-PLN-004, S-PLN-005), under the person's own session (RLS). Another workspace's rows read as absent.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";
import { isUuid } from "@/lib/artwork/queries";
import { isStage, type Allowance, type JurisdictionNode, type Stage } from "./rules";

type Db = SupabaseClient<Database>;

export type FamilyProduct = { id: string; name: string; stage: Stage };
export type Family = { id: string; name: string; products: FamilyProduct[] };
export type Operator = { name: string; address: string; country: string; approval_number?: string };

export type AddProductData = {
  families: Family[];
  nodes: JurisdictionNode[];
  regions: string[];
  defaultOperator: Operator | null;
};

const STAGE_ORDER: Record<Stage, number> = { active: 0, in_development: 1, brief: 2, discontinued: 3 };

export async function readAddProductData(db: Db, workspaceId: string): Promise<AddProductData> {
  const [families, nodes, ws] = await Promise.all([
    db
      .schema("app")
      .from("families")
      .select("id, name, created_at, products(id, name, stage, created_at)")
      .eq("workspace_id", workspaceId)
      .order("name"),
    db.schema("ref").from("jurisdictions").select("id, name, node_type, parent_id").order("id"),
    db.schema("app").from("workspaces").select("entitled_regions, default_operator").eq("id", workspaceId).maybeSingle(),
  ]);
  if (families.error) throw new ShellReadError("families", families.error);
  if (nodes.error) throw new ShellReadError("jurisdictions", nodes.error);
  if (ws.error) throw new ShellReadError("the workspace", ws.error);
  return {
    families: (families.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      products: (f.products ?? [])
        .flatMap((p) => (isStage(p.stage) ? [{ id: p.id, name: p.name, stage: p.stage, createdAt: p.created_at }] : []))
        .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.createdAt.localeCompare(b.createdAt))
        .map(({ id, name, stage }) => ({ id, name, stage })),
    })),
    nodes: nodes.data ?? [],
    regions: ws.data?.entitled_regions ?? [],
    defaultOperator: (ws.data?.default_operator as Operator | null) ?? null,
  };
}

export type DiscontinuedRow = {
  id: string;
  name: string;
  family: string;
  /** Other products share the family: the design names it under the product. */
  familyShared: boolean;
  discontinuedAt: string;
  /** From the audit event; null when none was given or the person's role cannot read audit events. */
  reason: string | null;
  reports: number;
  certificates: number;
  envelopes: number;
  /** The worst display state across its markets when it left the board; null when it was never checked anywhere. */
  lastState: "clear" | "action" | "not_assessed" | "blocked" | null;
  everChecked: boolean;
};

const WORST: Record<string, number> = { blocked: 3, action: 2, not_assessed: 1, clear: 0 };

export async function readDiscontinued(db: Db, workspaceId: string): Promise<{ rows: DiscontinuedRow[]; total: number }> {
  const [list, total] = await Promise.all([
    db
      .schema("app")
      .from("products")
      .select(
        "id, name, discontinued_at, families(name, products(count)), reports(count), certificates(count), envelopes(count), " +
          "product_nodes(display_state, last_check_job_id)",
      )
      .eq("workspace_id", workspaceId)
      .eq("stage", "discontinued")
      .order("discontinued_at", { ascending: false }),
    db.schema("app").from("products").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);
  if (list.error) throw new ShellReadError("discontinued products", list.error);
  if (total.error) throw new ShellReadError("products", total.error);
  type Row = {
    id: string;
    name: string;
    discontinued_at: string | null;
    families: { name: string; products: { count: number }[] } | null;
    reports: { count: number }[];
    certificates: { count: number }[];
    envelopes: { count: number }[];
    product_nodes: { display_state: string | null; last_check_job_id: string | null }[];
  };
  const data = (list.data ?? []) as unknown as Row[];
  const reasons = await readReasons(
    db,
    workspaceId,
    data.map((r) => r.id),
  );
  return {
    total: total.count ?? 0,
    rows: data.map((r) => {
      const checked = r.product_nodes.filter((n) => n.last_check_job_id);
      const worst = checked.reduce<string | null>(
        (w, n) => (n.display_state && (w === null || WORST[n.display_state] > WORST[w]) ? n.display_state : w),
        null,
      );
      return {
        id: r.id,
        name: r.name,
        family: r.families?.name ?? "",
        familyShared: (r.families?.products[0]?.count ?? 1) > 1,
        discontinuedAt: r.discontinued_at ?? "",
        reason: reasons.get(r.id) ?? null,
        reports: r.reports[0]?.count ?? 0,
        certificates: r.certificates[0]?.count ?? 0,
        envelopes: r.envelopes[0]?.count ?? 0,
        lastState: (worst as DiscontinuedRow["lastState"]) ?? null,
        everChecked: checked.length > 0,
      };
    }),
  };
}

/**
 * The latest discontinue reason per product, from product.stage_changed (#43 Q2: the reason lives only there). Audit
 * events are readable by admins and portfolio managers; for anyone else RLS returns none and the column reads "—".
 */
async function readReasons(db: Db, workspaceId: string, productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;
  const { data, error } = await db
    .schema("app")
    .from("audit_events")
    .select("object_id, after, at")
    .eq("workspace_id", workspaceId)
    .eq("kind", "product.stage_changed")
    .in("object_id", productIds)
    .order("at", { ascending: false });
  if (error) return out; // the reason is an annotation: its absence never hides the product
  for (const e of data ?? []) {
    const after = e.after as { stage?: string; reason?: string } | null;
    if (!out.has(e.object_id ?? "") && after?.stage === "discontinued") out.set(e.object_id ?? "", after.reason ?? "");
  }
  for (const [k, v] of out) if (!v) out.delete(k);
  return out;
}

export async function readAllowance(db: Db, workspaceId: string): Promise<Allowance | null> {
  const [a, w] = await Promise.all([
    db.schema("app").from("allowances").select("labels_used, labels_allowed").eq("workspace_id", workspaceId).maybeSingle(),
    db.schema("app").from("workspaces").select("plan").eq("id", workspaceId).maybeSingle(),
  ]);
  if (a.error) throw new ShellReadError("the allowance", a.error);
  if (w.error) throw new ShellReadError("the workspace", w.error);
  if (!a.data || !w.data) return null;
  return { plan: w.data.plan, used: a.data.labels_used, allowed: a.data.labels_allowed };
}

export type ProductDetail = {
  id: string;
  name: string;
  stage: Stage;
  familyId: string;
  nodes: string[];
};

export async function readProductDetail(db: Db, workspaceId: string, productId: string): Promise<ProductDetail | null> {
  if (!isUuid(productId)) return null;
  const { data, error } = await db
    .schema("app")
    .from("products")
    .select("id, name, stage, family_id, product_nodes(node_id)")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new ShellReadError("product", error);
  if (!data || !isStage(data.stage)) return null;
  return {
    id: data.id,
    name: data.name,
    stage: data.stage,
    familyId: data.family_id,
    nodes: (data.product_nodes ?? []).map((n) => n.node_id).sort(),
  };
}
