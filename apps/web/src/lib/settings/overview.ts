// S-NV2-017 Settings & roles (T-1110; A03, A05, A06, A08): the summary of Workspace Settings, read under the admin's
// own session. People come from readPeople (T-107), signing authority from app.signing_grants rows (BE-04: never
// implied by a role), the plan from the billing reads (T-703). Nothing here writes; every change happens on the page
// each section links to. Founder decision on issue 352 (26 Nov 2026): the plan card shows what D-03 sells (recipes,
// editor seats with viewers free, regions, checks never metered), and the workspace rows are only those with data and
// a decision behind them (no tenancy model, no term register version).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { plans } from "../../../../../config/pricing";
import { ROLE_TITLE, isActive, relativeTime, seatCount, type MemberRow, type PeopleData, type SeatCount } from "./people";

type Client = SupabaseClient<Database>;

export class OverviewReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read ${what}: ${cause.code ?? "error"} ${cause.message}`);
    this.name = "OverviewReadError";
  }
}

/** One active app.signing_grants row: whose, and for which jurisdiction node. */
export type Grant = { personId: string; nodeId: string };

/** What the plan card shows, or why it cannot: billing is read only by an internal admin of the whole workspace. */
export type PlanFacts =
  | {
      kind: "read";
      /** app.workspaces.plan */
      plan: string;
      recipes: number;
      /** app.subscriptions.recipes_included; null means no recipe check (Free within its allowance, Advanced). */
      recipesIncluded: number | null;
      regions: string[];
      /** Checks run this calendar month (UTC), app.checks rows read under RLS: shown, never metered. */
      checksThisMonth: number;
    }
  | { kind: "no-billing" };

export type OverviewData = {
  people: PeopleData;
  grants: Grant[];
  /** The latest released ruleset, or null before the first release. */
  ruleset: string | null;
  /** Markets (jurisdiction nodes) inside the workspace's purchased regions. */
  marketsInReach: number;
  plan: PlanFacts;
};

/** The first instant of the month `now` falls in, UTC. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** The reads besides people and the plan: active signing grants, the current ruleset, the markets in reach. */
export async function readOverviewFacts(supabase: Client, ws: string, regions: string[]) {
  const [grants, ruleset, markets] = await Promise.all([
    supabase.schema("app").from("signing_grants").select("person_id, node_id").eq("workspace_id", ws).is("revoked_at", null).order("node_id"),
    supabase
      .schema("ref")
      .from("ruleset_versions")
      .select("id")
      .not("released_at", "is", null)
      .order("released_at", { ascending: false })
      .limit(1),
    supabase.schema("ref").from("jurisdictions").select("id, parent_id").not("parent_id", "is", null),
  ]);
  if (grants.error) throw new OverviewReadError("signing grants", grants.error);
  if (ruleset.error) throw new OverviewReadError("the ruleset", ruleset.error);
  if (markets.error) throw new OverviewReadError("markets", markets.error);
  return {
    grants: grants.data.map((g) => ({ personId: g.person_id, nodeId: g.node_id })),
    ruleset: ruleset.data[0]?.id ?? null,
    marketsInReach: markets.data.filter((m) => regions.includes(m.parent_id ?? "")).length,
  };
}

/** Checks run in the workspace this month: app.checks rows the admin reads under RLS. */
export async function readChecksThisMonth(supabase: Client, ws: string, now: Date): Promise<number> {
  const { count, error } = await supabase
    .schema("app")
    .from("checks")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .gte("at", monthStart(now));
  if (error) throw new OverviewReadError("checks this month", error);
  return count ?? 0;
}

// ── What each row says ──────────────────────────────────────────────────────────────────────────────────────────

/** "DE" for EU-DE, "TX" for US-TX, "EU" for the region itself: the design writes markets by their short code. */
export const marketCode = (nodeId: string) => nodeId.split("-").pop() ?? nodeId;

export type PersonLine = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  /** "DE · AT · NL · BE", or "None". */
  signing: string;
  /** clear when the person holds a grant; action for an external (who can never hold one, BE-04); none otherwise. */
  signingTone: "clear" | "action" | "none";
  last: string;
};

/** The People and roles table: active members in the order People lists them, each with their grants. */
export function personLines(members: MemberRow[], grants: Grant[], now: Date): PersonLine[] {
  return members
    .filter((m) => isActive(m.scope, now))
    .map((m) => {
      const held = grants.filter((g) => g.personId === m.personId).map((g) => marketCode(g.nodeId));
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.external ? `${ROLE_TITLE[m.role]} · external` : ROLE_TITLE[m.role],
        signing: held.length ? held.join(" · ") : "None",
        signingTone: held.length ? "clear" : m.external ? "action" : "none",
        last: relativeTime(m.lastActive, now),
      };
    });
}

export type WorkspaceLine = { k: string; note: string; v: string; tone: "clear" | "none"; link?: { label: string; route: string } };

/** The Workspace rows that have data and a decision behind them (issue 352): ruleset, markets, signing policy. */
export function workspaceLines(ruleset: string | null, marketsInReach: number): WorkspaceLine[] {
  return [
    {
      k: "Ruleset version",
      // F01: the board says which ruleset each answer was judged against, and an earlier one reads as stale.
      note: "Answers judged against an earlier ruleset read as stale on the board until they are checked again.",
      v: ruleset ?? "NONE RELEASED",
      tone: ruleset ? "clear" : "none",
    },
    {
      k: "Markets enabled",
      note: "Coverage depth per jurisdiction node is published on the coverage page.",
      v: `${marketsInReach} IN REACH`,
      tone: marketsInReach > 0 ? "clear" : "none",
      link: { label: "Coverage & confidence", route: "/w/[workspace]/library/coverage" },
    },
    {
      k: "Signing policy",
      note: "Granted per market by an administrator. The Compliance Worker can never sign.",
      v: "PER MARKET",
      tone: "clear",
    },
  ];
}

/** Thousands with a thin space, as the design writes "1 412". */
const num = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

const planName = (key: string) => plans.find((p) => p.key === key)?.name ?? key;

const ofLimit = (used: number, limit: number | null, what: string) =>
  limit === null ? `${num(used)} · no ${what} limit` : `${num(used)} of ${num(limit)}`;

/** The plan card's rows: what D-03 sells, never metered checks included. */
export function planLines(plan: Extract<PlanFacts, { kind: "read" }>, seats: SeatCount): { k: string; v: string }[] {
  return [
    { k: "Plan", v: planName(plan.plan) },
    { k: "Recipes", v: ofLimit(plan.recipes, plan.recipesIncluded, "recipe") },
    { k: "Editor seats", v: `${ofLimit(seats.used, seats.seats, "seat")} · viewers free` },
    { k: "Regions", v: plan.regions.length ? plan.regions.join(" · ") : "None" },
    { k: "Checks this month", v: `${num(plan.checksThisMonth)} · unmetered` },
  ];
}

export { seatCount };
