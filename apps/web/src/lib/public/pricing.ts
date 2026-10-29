// The pricing page and the landing page's plans (P02) take every name, price and dial from config/pricing.ts, the
// same file the Stripe catalogue script reads (docs/08-billing.md). Nothing here restates a figure the config holds.
import { addons, plans, type AddonKey, type Interval, type PaidPlanKey, type Plan, type PlanKey } from "../../../../../config/pricing";

export { addons, plans };
export type { Interval, PlanKey };

/** The free allowance: three new label artworks per workspace (D-03, docs/08 "Plans and dials"); config has no field. */
export const FREE_ARTWORKS = 3;

/** Partner, after launch (N01): €1,499 per 10 client workspaces (D-03, docs/08). Not in config: it is not catalogued. */
export const PARTNER = { name: "Partner", monthly: 1_499_00, clientWorkspaces: 10 } as const;

const EUR = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** €249, €2,490: whole euros, as the designs print them. */
export const euros = (minor: number) => EUR.format(minor / 100);

export function plan(key: PlanKey): Plan {
  const found = plans.find((p) => p.key === key);
  if (!found) throw new Error(`no plan ${key} in config/pricing.ts`);
  return found;
}

/** The plan's net price for the interval in minor units; 0 for the free allowance. */
export function amount(key: PlanKey, interval: Interval): number {
  return plan(key).prices.find((p) => p.currency === "eur" && p.interval === interval)?.amount ?? 0;
}

/** "€249", "from €999" for a floor price. */
export function priceLabel(key: PlanKey, interval: Interval): string {
  return `${plan(key).from ? "from " : ""}${euros(amount(key, interval))}`;
}

/** An add-on's net price for a plan, or null where that plan cannot buy it. */
export function addonAmount(key: AddonKey, planKey: PaidPlanKey, interval: Interval): number | null {
  const addon = addons.find((a) => a.key === key);
  return addon?.prices[planKey]?.find((p) => p.currency === "eur" && p.interval === interval)?.amount ?? null;
}

/** Whole months the yearly price saves against twelve monthly ones (the designs' "two months free"). */
export function monthsFree(key: PaidPlanKey): number {
  const month = amount(key, "month");
  return month ? Math.round((month * 12 - amount(key, "year")) / month) : 0;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
export const inWords = (n: number) => WORDS[n] ?? String(n);
