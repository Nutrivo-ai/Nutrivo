// The chip every Billing settings screen carries on the right of its header (design: "STANDARD · ANNUAL · RENEWS
// 4 SEP 2027"), from the subscription mirror and the live counts.
import { plan as planOf } from "@/lib/public/pricing";
import { isLive, isPaidPlan, type LiveCounts } from "./plans";
import type { Subscription } from "./read";

export type Chip = { text: string; tone: "n600" | "clear" | "blocked" };

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mono = (iso: string) => DAY.format(new Date(iso)).replace("Sept", "Sep").toUpperCase();

export function billingChip(subscription: Subscription | null, counts: LiveCounts): Chip {
  const s = subscription;
  if (s && isLive(s.status) && isPaidPlan(s.plan)) {
    const name = planOf(s.plan).name.toUpperCase();
    const term = s.term === "annual" ? "ANNUAL" : "MONTHLY";
    if (s.status === "past_due" || s.status === "unpaid") return { text: `${name} · ${term} · PAYMENT FAILED`, tone: "blocked" };
    return { text: `${name} · ${term}${s.currentPeriodEnd ? ` · RENEWS ${mono(s.currentPeriodEnd)}` : ""}`, tone: "clear" };
  }
  return { text: `FREE · ${counts.labelsUsed} OF ${counts.labelsAllowed} LABELS USED`, tone: "n600" };
}
