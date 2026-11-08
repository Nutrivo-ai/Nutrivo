// S-PLN-001 (T-703 · M01, M02): the plan picker's cards and headline, built from the live counts and
// config/pricing.ts. The recommended plan is the smallest whose list price plus capped overage covers the counts
// (approved on #64); a card that needs add-ons says what they cost. Pure, so the wording is tested and the screen only draws it. Every price is net ("EXCL. VAT"):
// VAT is added on the invoice (M01.must.1, BE-35).
import { addonAmount, amount, plan, type PlanKey } from "@/lib/public/pricing";
import { fitFor, INTERVAL, isLive, NEXT_REGION_NOTE, nextPlan, recommended, type LiveCounts, type Term } from "./plans";
import type { PaidPlanKey } from "../../../../../config/pricing";

export type Tone = "ink" | "n600" | "n700" | "clear" | "action" | "blocked" | "accent" | "none";

export type CardAction =
  | { kind: "checkout"; plan: PaidPlanKey; primary: boolean; label: string }
  | { kind: "switch"; plan: PaidPlanKey; label: string } // a live subscription changes plan in the portal
  | { kind: "contact"; label: string } // Advanced is quoted
  | { kind: "none"; label: string }; // a dashed box, not a control

export type Card = {
  key: PlanKey;
  name: string;
  tag: string | null;
  /** The recommended card is drawn in the accent. */
  on: boolean;
  price: string;
  per: string;
  basis: string;
  rows: { k: string; v: string; tone: Tone }[];
  verdict: string;
  verdictTone: Tone;
  action: CardAction;
};

export type Picker = {
  recommended: PaidPlanKey;
  headline: string;
  lede: string;
  usage: { k: string; n: string; v: string; tone: Tone }[];
  cards: Card[];
  overage: { plan: PaidPlanKey; next: PaidPlanKey; body: string; rows: { k: string; v: string; tone: Tone }[] } | null;
};

export type PickerInput = {
  counts: LiveCounts;
  checksRun: number;
  term: Term;
  /** The workspace's plan and the mirrored subscription's status. */
  plan: string;
  subscriptionStatus: string | null;
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const words = (n: number) => WORDS[n] ?? String(n);
const Words = (n: number) => {
  const w = words(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const plural = (n: number, one: string, many: string) => `${words(n)} ${n === 1 ? one : many}`;

const EUR = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euros = (minor: number) => EUR.format(minor / 100);

const BASIS: Record<PlanKey, string> = {
  free: "Three labels, the whole product, sending included.",
  basic: "One region, priced for a single brand selling into one regime.",
  standard: `Thirty recipes and room for a second region, which is the reason most brands move here. ${NEXT_REGION_NOTE}`,
  advanced: `Unlimited recipes, people unlimited and free, and signed certificates. Every region as it launches.`,
};

export function buildPicker({ counts, checksRun, term, plan: currentPlan, subscriptionStatus }: PickerInput): Picker {
  const best = recommended(counts);
  const live = isLive(subscriptionStatus);
  const interval = INTERVAL[term];
  const per = term === "annual" ? "PER YEAR · EXCL. VAT" : "PER MONTH · EXCL. VAT";
  const unit = term === "annual" ? "yr" : "mo";
  const usedUp = counts.labelsUsed >= counts.labelsAllowed;
  const regions = Math.max(1, counts.regions.length);

  const cardFor = (key: PaidPlanKey): Card => {
    const p = plan(key);
    const fit = fitFor(key, counts);
    const isCurrent = live && currentPlan === key;
    const rows: Card["rows"] = [];
    rows.push({ k: "Recipes", v: p.recipes === null ? "UNLIMITED" : String(p.recipes), tone: fit.extraRecipes ? "action" : "clear" });
    rows.push(
      key === "basic"
        ? { k: "Regions", v: "EU · fixed", tone: "action" }
        : key === "standard"
          ? { k: "Regions", v: "EU + 1 later", tone: "clear" }
          : { k: "Regions", v: "EVERY REGION", tone: "clear" },
    );
    rows.push(p.editors === null ? { k: "People", v: "FREE", tone: "clear" } : { k: "Editors", v: String(p.editors), tone: fit.extraEditors ? "action" : "clear" });
    const extra = addonAmount("recipe", key, interval);
    if (extra !== null) rows.push({ k: "Extra recipe", v: `${euros(extra)}/${unit}`, tone: "n700" });

    let verdict: string;
    let verdictTone: Tone;
    const each = (addon: "recipe" | "editor_seat") => euros(addonAmount(addon, key, "month") ?? 0);
    const extras: string[] = [];
    if (fit.extraRecipes) extras.push(`${Words(counts.recipes)} recipes: ${words(p.recipes ?? 0)} included and ${words(fit.extraRecipes)} at ${each("recipe")} each a month.`);
    if (fit.extraEditors) extras.push(`${Words(counts.editorSeats)} editors: ${words(p.editors ?? 0)} included and ${words(fit.extraEditors)} at ${each("editor_seat")} each a month.`);
    if (!fit.fits) {
      // BE-34: past the ceiling (or past the regions the plan holds) the next plan is offered, not more overage.
      const why: string[] = [];
      if (fit.extraRecipes || fit.extraEditors) {
        why.push(fit.pastCap && p.overageCap !== null
          ? `${extras.join(" ")} That passes the ${euros(p.overageCap)} ceiling.`
          : extras.join(" "));
      }
      if (!fit.regionsFit) why.push(`${Words(regions)} regions is more than it holds.`);
      verdict = `${why.join(" ")} The ${plan(nextPlan(key)).name} plan is offered instead.`;
      verdictTone = "blocked";
    } else if (extras.length) {
      verdict = `${extras.join(" ")} ${euros(fit.monthly)} a month in all.`;
      verdictTone = key === best ? "clear" : "action";
    } else if (key === best) {
      const spare: string[] = [];
      if (p.recipes !== null) spare.push(plural(p.recipes - counts.recipes, "recipe", "recipes"));
      if (p.editors !== null && p.editors > counts.editorSeats) spare.push(plural(p.editors - counts.editorSeats, "editor seat", "editor seats"));
      verdict = spare.length ? `Everything you have, with ${spare.join(" and ")} spare.` : "Everything you have, with room to grow.";
      if (key === "basic") verdict += " One region only, with no add-on.";
      verdictTone = "clear";
    } else if (key === "basic") {
      verdict = `${Words(p.recipes ?? 0)} recipes fits. ${Words(p.editors ?? 0)} editors fits. One region only, with no add-on.`;
      verdictTone = "action";
    } else {
      verdict = "More than you need now. It is here when you grow.";
      verdictTone = "none";
    }

    let action: CardAction;
    if (key === "advanced") action = isCurrent ? { kind: "none", label: "Your plan" } : { kind: "contact", label: "Talk to us" };
    else if (isCurrent) action = { kind: "none", label: "Your plan" };
    else if (!fit.fits) action = { kind: "none", label: "Too small for this workspace" };
    else if (live) action = { kind: "switch", plan: key, label: `Switch to ${p.name}` };
    else action = { kind: "checkout", plan: key, primary: key === best, label: key === best ? "Continue to checkout" : `Choose ${p.name}` };

    return {
      key,
      name: p.name,
      tag: isCurrent ? "YOUR PLAN" : key === best ? "FITS YOUR WORKSPACE" : null,
      on: key === best,
      price: `${p.from ? "from " : ""}${euros(amount(key, interval))}`,
      per: key === "advanced" && term === "monthly" ? "PER MONTH · EXCL. VAT" : per,
      basis: BASIS[key],
      rows,
      verdict,
      verdictTone,
      action,
    };
  };

  const free: Card = {
    key: "free",
    name: "Free",
    tag: usedUp ? "USED UP" : currentPlan === "free" && !live ? "YOUR PLAN" : null,
    on: false,
    price: "€0",
    per: "THREE LABELS · NO CARD, NO CLOCK",
    basis: `${BASIS.free} ${usedUp ? "You have used all three." : counts.labelsUsed === 0 ? "You have used none yet." : `You have used ${words(counts.labelsUsed)}.`}`,
    rows: [
      { k: "Labels", v: `${counts.labelsUsed} OF ${counts.labelsAllowed}`, tone: usedUp ? "blocked" : "n700" },
      { k: "Regions", v: "EU", tone: "n700" },
      { k: "Editors", v: "NO SEAT CHECK", tone: "n700" },
      { k: "Sending", v: "INCLUDED", tone: "clear" },
    ],
    verdict: usedUp
      ? "You are past it. A fourth label needs a plan."
      : `${Words(counts.labelsAllowed - counts.labelsUsed)} of three free labels left.`,
    verdictTone: usedUp ? "blocked" : "n700",
    action: { kind: "none", label: live ? "Every plan includes it" : usedUp ? "All three used" : "Your plan now" },
  };

  const headline = live && currentPlan === best
    ? `${plan(best).name} still fits what you have`
    : `${plan(best).name} is the plan that fits what you already have`;
  const lede =
    `Read from this workspace, not from a brochure. ${Words(counts.recipes)} ${counts.recipes === 1 ? "recipe" : "recipes"}, ` +
    `${plural(regions, "region", "regions")} and ${plural(counts.editorSeats, "person who edits", "people who edit")}. ` +
    "Nothing here is a guess about what you might need later.";

  const capped = best === "advanced" ? "standard" : best;
  const cp = plan(capped);
  const recipePrice = addonAmount("recipe", capped, "month") ?? 0;
  const next = nextPlan(capped);
  const overage = cp.overageCap === null || cp.recipes === null ? null : {
    plan: capped,
    next,
    body:
      `Extra recipes are ${euros(recipePrice)} each per month, and the bill stops at half again the list price — ${euros(cp.overageCap)}. ` +
      `Past that we offer ${plan(next).name} rather than keep charging, because paying ${plan(next).name} money for ${cp.name} value is not a deal either of us wants.`,
    rows: [
      { k: `Recipes ${cp.recipes + 1} to ${cp.recipes + 10}`, v: `${euros(recipePrice)} each per month`, tone: "n700" as Tone },
      { k: "All prices", v: "EXCLUDE VAT", tone: "n600" as Tone },
      { k: "Hard ceiling on the bill", v: `${euros(cp.overageCap)} per month`, tone: "action" as Tone },
      { k: "Past the ceiling", v: `WE OFFER ${plan(next).name.toUpperCase()}`, tone: "accent" as Tone },
    ],
  };

  return {
    recommended: best,
    headline,
    lede,
    usage: [
      { k: "Recipes", n: String(counts.recipes), v: "Pack sizes and artwork versions are free", tone: "ink" },
      { k: regions === 1 ? "Region" : "Regions", n: String(regions), v: "EU · all 27 member states in reach", tone: "ink" },
      { k: "People who edit", n: String(counts.editorSeats), v: "People who only read cost nothing", tone: "ink" },
      { k: "Checks run", n: String(checksRun), v: "Since you started. None of them metered", tone: "clear" },
    ],
    cards: [free, cardFor("basic"), cardFor("standard"), cardFor("advanced")],
    overage,
  };
}

export const NEVER_METERED = [
  "Checks and re-checks",
  "Language-correct checking",
  "The four states",
  "Where each answer came from",
  "Coverage links and named gaps",
  "Registration obligations named",
  "Reading your own answer",
];
