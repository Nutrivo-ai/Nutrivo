// T-902 · J04: the reads behind the alerts inbox and the horizon, under the person's own session. RLS decides what any
// of them returns: app.alerts by product and market scope, app.alert_reads only the caller's own rows (BE-39).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buildCards,
  buildHorizon,
  type AlertCard,
  type AlertRow,
  type CitationRow,
  type DiffRow,
  type Horizon,
  type HorizonItemRow,
  type JurisdictionRow,
  type ProductRow,
  type RuleRow,
} from "./model";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

export class AlertsReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the alerts (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "AlertsReadError";
  }
}

function ok<T>(what: string, r: Result<T>): T {
  if (r.error) throw new AlertsReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000; // PostgREST's max_rows (supabase/config.toml)
const BATCH = 60; // ids per `in` filter, so a URL stays short
/** The inbox reads at most this many alert rows, newest first: years of changes for a large portfolio. */
export const ALERT_READ_CAP = 10_000;

async function paged<T>(what: string, query: (from: number, to: number) => PromiseLike<Result<T[]>>, cap: number): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const page = ok(what, await query(from, from + PAGE - 1)) ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out.slice(0, cap);
}

async function inBatches<T>(what: string, ids: string[], query: (batch: string[]) => PromiseLike<Result<T[]>>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(...(ok(what, await query(ids.slice(i, i + BATCH))) ?? []));
  return out;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type AlertsData = { kind: "not-found" } | { kind: "loaded"; cards: AlertCard[]; today: string };

/** Every alert the person can read in the workspace, grouped per rule diff, with their own read state. */
export async function readAlertCards(supabase: Client, workspaceId: string, today: string = todayUtc()): Promise<AlertsData> {
  if (!UUID.test(workspaceId)) return { kind: "not-found" };
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");

  const ws = ok<{ id: string; entitled_regions: string[] | null } | null>(
    "workspace",
    await app.from("workspaces").select("id, entitled_regions").eq("id", workspaceId).maybeSingle(),
  );
  if (!ws) return { kind: "not-found" };

  const alerts = await paged<AlertRow>(
    "alerts",
    (from, to) =>
      app
        .from("alerts")
        .select("id, rule_diff_id, product_id, node_id, phase, effect_type, effective_from, sell_through_until, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ALERT_READ_CAP,
  );
  if (!alerts.length) return { kind: "loaded", cards: [], today };

  const diffIds = [...new Set(alerts.map((a) => a.rule_diff_id))];
  const productIds = [...new Set(alerts.map((a) => a.product_id))];

  const [reads, diffs, products, places] = await Promise.all([
    // The caller's own read rows only (policy read_own), for this workspace's alerts.
    paged<{ alert_id: string }>(
      "read state",
      (from, to) =>
        app
          .from("alert_reads")
          .select("alert_id, alerts!inner(workspace_id)")
          .eq("alerts.workspace_id", workspaceId)
          .order("alert_id")
          .range(from, to) as unknown as PromiseLike<Result<{ alert_id: string }[]>>,
      ALERT_READ_CAP,
    ),
    inBatches<DiffRow>("rule changes", diffIds, (b) => ref.from("rule_diffs").select("id, rule_key, to_version").in("id", b)),
    inBatches<ProductRow>("recipes", productIds, (b) => app.from("products").select("id, name, stage").in("id", b)),
    ref.from("jurisdictions").select("id, name, parent_id"),
  ]);
  const jurisdictions = (ok("markets", places) ?? []) as JurisdictionRow[];
  const ruleKeys = [...new Set(diffs.map((d) => d.rule_key))];
  const [rules, citations] = await Promise.all([
    inBatches<RuleRow>("rules", ruleKeys, (b) => ref.from("rules").select("rule_key, title").in("rule_key", b)),
    // Only accepted versions are readable (ref.rule_versions' policy), so a citation is always an accepted one.
    inBatches<CitationRow>("citations", ruleKeys, (b) => ref.from("rule_versions").select("rule_key, version, article_ref").in("rule_key", b)),
  ]);

  const cards = buildCards({
    workspaceId,
    today,
    entitledRegions: ws.entitled_regions ?? [],
    alerts,
    readIds: new Set(reads.map((r) => r.alert_id)),
    diffs,
    rules,
    citations,
    products,
    jurisdictions,
  });
  return { kind: "loaded", cards, today };
}

export type HorizonData = { kind: "not-found" } | { kind: "loaded"; horizon: Horizon; today: string };

/** The coming changes from the inbox and the horizon items not yet in force. */
export async function readHorizon(supabase: Client, workspaceId: string, today: string = todayUtc()): Promise<HorizonData> {
  const alerts = await readAlertCards(supabase, workspaceId, today);
  if (alerts.kind === "not-found") return alerts;
  const items = (ok(
    "horizon",
    await supabase
      .schema("ref")
      .from("horizon_items")
      .select("id, title, stage, expected_date, effective_from, celex")
      .neq("stage", "in_force")
      .order("created_at", { ascending: false })
      .limit(200),
  ) ?? []) as HorizonItemRow[];
  return { kind: "loaded", horizon: buildHorizon(workspaceId, alerts.cards, items, today), today };
}
