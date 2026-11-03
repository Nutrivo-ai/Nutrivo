// M01, M02 (T-703): which plan fits the workspace, read from its live counts (BE-33) and priced from config/pricing.ts,
// the same file the Stripe catalogue is made from. Pure: no I/O, so the plan picker, checkout and Plan and allowance
// all say the same thing, and the tests can hold it to BE-34.
//
// BE-34: a paid plan's recipe overage (and extra editor seats) is charged per month up to 1.5x the plan's list price
// (config `overageCap`). A workspace whose monthly bill on a plan would pass that cap does not fit the plan: the next
// plan is offered instead.
// D-03 (3 Nov 2026): only the EU region exists at launch, so the region add-on is not for sale; Standard and Advanced
// say more regions are added as they launch.
import { addonAmount, amount, plan, type Interval } from "@/lib/public/pricing";
import type { PaidPlanKey, PlanKey } from "../../../../../config/pricing";

export const PAID: PaidPlanKey[] = ["basic", "standard", "advanced"];

/** app.subscriptions.term, as the mirror stores it. */
export type Term = "monthly" | "annual";
export const INTERVAL: Record<Term, Interval> = { monthly: "month", annual: "year" };

/** Regions released for sale (D-03). The region add-on is offered only once a second one exists. */
export const RELEASED_REGIONS = ["EU"] as const;
export const REGION_ADDON_ON_SALE = RELEASED_REGIONS.length > 1;
export const NEXT_REGION_NOTE = "More regions are added as they launch; the UK is planned for Q1 2027.";

/** app.live_billable_counts(workspace_id), read on every request (M02.must.1). */
export type LiveCounts = {
  recipes: number;
  regions: string[];
  editorSeats: number;
  labelsUsed: number;
  labelsAllowed: number;
};

/** Accepts the RPC's jsonb as returned, so a missing or odd field reads as zero rather than throwing. */
export function readCounts(raw: unknown): LiveCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  return {
    recipes: n(r.recipes),
    regions: Array.isArray(r.regions) ? r.regions.filter((x): x is string => typeof x === "string") : [],
    editorSeats: n(r.editor_seats),
    labelsUsed: n(r.labels_used),
    labelsAllowed: r.labels_allowed == null ? 3 : n(r.labels_allowed),
  };
}

export type Fit = {
  plan: PaidPlanKey;
  /** Recipes over the plan's allowance, and their monthly cost (minor units). */
  extraRecipes: number;
  extraRecipesMonthly: number;
  /** Editors over the plan's seats, and their monthly cost. */
  extraEditors: number;
  extraEditorsMonthly: number;
  /** List price plus the extras, per month (minor units). */
  monthly: number;
  /** BE-34: the bill on this plan would pass 1.5x list, so the next plan is offered instead. */
  pastCap: boolean;
  /** The workspace's regions fit the plan without an add-on that is not on sale. */
  regionsFit: boolean;
  /** Within the plan's included recipes, seats and regions: nothing extra to pay. */
  holds: boolean;
  /** Within the plan's ceiling (BE-34), extras included. */
  fits: boolean;
};

export function fitFor(key: PaidPlanKey, counts: LiveCounts): Fit {
  const p = plan(key);
  const list = amount(key, "month");
  const extraRecipes = p.recipes === null ? 0 : Math.max(0, counts.recipes - p.recipes);
  const extraEditors = p.editors === null ? 0 : Math.max(0, counts.editorSeats - p.editors);
  const recipePrice = addonAmount("recipe", key, "month");
  const seatPrice = addonAmount("editor_seat", key, "month");
  // A plan that sells no recipe (or seat) add-on cannot hold one more than it includes.
  const recipesBlocked = extraRecipes > 0 && recipePrice === null;
  const editorsBlocked = extraEditors > 0 && seatPrice === null;
  const extraRecipesMonthly = extraRecipes * (recipePrice ?? 0);
  const extraEditorsMonthly = extraEditors * (seatPrice ?? 0);
  const monthly = list + extraRecipesMonthly + extraEditorsMonthly;
  const pastCap = p.overageCap !== null && monthly > p.overageCap;
  const regions = Math.max(1, counts.regions.length);
  // Until a second region is released the add-on cannot be bought, so a plan holds only the regions it includes.
  const regionsFit = regions <= (REGION_ADDON_ON_SALE ? p.regionsMax : p.regionsIncluded);
  return {
    plan: key,
    extraRecipes,
    extraRecipesMonthly,
    extraEditors,
    extraEditorsMonthly,
    monthly,
    pastCap: pastCap || recipesBlocked || editorsBlocked,
    regionsFit,
    holds: extraRecipes === 0 && extraEditors === 0 && regionsFit,
    fits: !(pastCap || recipesBlocked || editorsBlocked) && regionsFit,
  };
}

/**
 * The smallest paid plan that holds the workspace as it is, with nothing extra to pay. Overage (BE-34) is for growing
 * mid-term, never something to subscribe into, so a workspace that outgrows a plan is offered the next one.
 */
export function recommended(counts: LiveCounts): PaidPlanKey {
  return PAID.find((k) => fitFor(k, counts).holds) ?? "advanced";
}

/** The plan after this one: what BE-34 offers once a plan's ceiling is met. */
export function nextPlan(key: PlanKey): PaidPlanKey {
  return key === "free" ? "basic" : key === "basic" ? "standard" : "advanced";
}

/** The net price of a plan for a term, in minor units (VAT is added on the invoice, BE-35). */
export function netPrice(key: PaidPlanKey, term: Term): number {
  return amount(key, INTERVAL[term]);
}

/** What paying annually saves against twelve monthly payments, in minor units. */
export function annualSaving(key: PaidPlanKey): number {
  return amount(key, "month") * 12 - amount(key, "year");
}

/** The share of the monthly total the annual price saves, as the design prints it ("16.7%"). */
export function annualSavingPercent(key: PaidPlanKey): string {
  const year = amount(key, "month") * 12;
  return `${((annualSaving(key) / year) * 100).toFixed(1)}%`;
}

/** A subscription that is live in Stripe: the workspace changes plan in the portal, never with a second checkout. */
export function isLive(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing" || status === "past_due" || status === "unpaid";
}

export function isPaidPlan(key: string | null | undefined): key is PaidPlanKey {
  return key === "basic" || key === "standard" || key === "advanced";
}

export function isTerm(t: string | null | undefined): t is Term {
  return t === "monthly" || t === "annual";
}
