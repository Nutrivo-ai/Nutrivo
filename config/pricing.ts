// The single source of Nutrivo's prices: the pricing page and the Stripe catalogue script
// (scripts/stripe/catalogue.ts) both read this file (docs/08-billing.md). Figures come from D-03 and the Priced Ladder
// (design/build/Nutrivo Pricing - Priced Ladder.dc.html), whose Free row is superseded by the three-artwork allowance.
// Amounts are net, in minor units (cents); VAT is added on the invoice. Euro only at launch (D-22): a new currency is
// a new row in `prices`, never a runtime conversion (BE-31).
// Plain TypeScript only (no enums or namespaces), so Node runs it with type stripping and no build step.

export type Currency = "eur";
export type Interval = "month" | "year";
export type PlanKey = "free" | "basic" | "standard" | "advanced";
export type PaidPlanKey = Exclude<PlanKey, "free">;

export interface Price {
  currency: Currency;
  interval: Interval;
  amount: number; // minor units, net of VAT
}

export interface Plan {
  key: PlanKey;
  name: string;
  /** Recipes (product families) included; null means no limit. */
  recipes: number | null;
  /** Regions included in the plan price. */
  regionsIncluded: number;
  /** Most regions the plan can hold, add-ons included. */
  regionsMax: number;
  /** Editor seats included; null means no seat check (viewers are always free). */
  editors: number | null;
  /** Monthly cap on recipe overage, in minor units (BE-34); null where there is no overage. */
  overageCap: number | null;
  /** Price is a floor ("from"); work above it is quoted. */
  from: boolean;
  /** No Stripe product: the free allowance has no subscription (D-21). */
  billable: boolean;
  prices: Price[];
}

export type AddonKey = "region" | "recipe" | "editor_seat";

export interface Addon {
  key: AddonKey;
  name: string;
  /** Per-plan prices: a plan that is absent cannot buy the add-on. */
  prices: Partial<Record<PaidPlanKey, Price[]>>;
}

const eur = (month: number, year: number): Price[] => [
  { currency: "eur", interval: "month", amount: month * 100 },
  { currency: "eur", interval: "year", amount: year * 100 },
];

export const plans: Plan[] = [
  // Three new label artworks per workspace, the whole product, no card, no clock (BE-32).
  { key: "free", name: "Free", recipes: null, regionsIncluded: 1, regionsMax: 1, editors: null, overageCap: null,
    from: false, billable: false, prices: [] },
  { key: "basic", name: "Basic", recipes: 10, regionsIncluded: 1, regionsMax: 1, editors: 3, overageCap: 374_00,
    from: false, billable: true, prices: eur(249, 2_490) },
  { key: "standard", name: "Standard", recipes: 30, regionsIncluded: 1, regionsMax: 2, editors: 5, overageCap: 749_00,
    from: false, billable: true, prices: eur(499, 4_990) },
  { key: "advanced", name: "Advanced", recipes: null, regionsIncluded: 3, regionsMax: 3, editors: null,
    overageCap: null, from: true, billable: true, prices: eur(999, 9_990) },
];

export const addons: Addon[] = [
  { key: "region", name: "Additional region", prices: { standard: eur(199, 1_990) } },
  { key: "recipe", name: "Additional recipe", prices: { basic: eur(15, 150), standard: eur(12, 120) } },
  { key: "editor_seat", name: "Additional editor", prices: { basic: eur(50, 500), standard: eur(50, 500) } },
];
