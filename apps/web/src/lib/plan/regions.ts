// J04.must.1 (T-902): a finding in a market whose region the workspace's plan does not hold cannot be opened. The plan's
// regions are app.workspaces.entitled_regions (EU, UK, US); a market's region is its jurisdiction's parent, or itself
// for a region. Every screen that shows a finding's content (the verdict, the label report, the board's findings view)
// reads the plan here and shows the not-in-plan state instead. Alerts still name the change and its recipes. RLS keys on
// membership scope, not on the plan; adding the plan to the checks' policies is a db question on #73.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type Plan = {
  regions: ReadonlySet<string>;
  /** Market → its region, for every jurisdiction. */
  regionOf: ReadonlyMap<string, string>;
  /** Region id → its name ("United States"). */
  names: ReadonlyMap<string, string>;
};

export type JurisdictionRow = { id: string; name: string; parent_id: string | null };

export class PlanReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the plan (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "PlanReadError";
  }
}

export function buildPlan(entitledRegions: readonly string[], jurisdictions: readonly JurisdictionRow[]): Plan {
  return {
    regions: new Set(entitledRegions),
    regionOf: new Map(jurisdictions.map((j) => [j.id, j.parent_id ?? j.id])),
    names: new Map(jurisdictions.filter((j) => j.parent_id === null).map((j) => [j.id, j.name])),
  };
}

/** The region a market sits in; an unknown id is its own region (and so in no plan unless named). */
export function regionOf(plan: Plan, nodeId: string): string {
  return plan.regionOf.get(nodeId) ?? nodeId;
}

export function inPlan(plan: Plan, nodeId: string): boolean {
  return plan.regions.has(regionOf(plan, nodeId));
}

export function regionName(plan: Plan, nodeId: string): string {
  const region = regionOf(plan, nodeId);
  return plan.names.get(region) ?? region;
}

/** The workspace's plan, under the person's session. Null when the workspace is not readable to them. */
export async function readPlan(db: SupabaseClient<Database>, workspaceId: string): Promise<Plan | null> {
  const [ws, places] = await Promise.all([
    db.schema("app").from("workspaces").select("entitled_regions").eq("id", workspaceId).maybeSingle(),
    db.schema("ref").from("jurisdictions").select("id, name, parent_id"),
  ]);
  if (ws.error) throw new PlanReadError("workspace", ws.error);
  if (places.error) throw new PlanReadError("markets", places.error);
  if (!ws.data) return null;
  return buildPlan(ws.data.entitled_regions ?? [], places.data ?? []);
}
