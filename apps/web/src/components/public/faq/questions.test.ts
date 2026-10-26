// S-FAQ-001: the FAQ's prices come from config/pricing.ts, and its fixed wording about the annual term still holds
// for every paid plan there.
import { describe, expect, it } from "vitest";
import { monthsFree, plans } from "@/lib/public/pricing";
import { GROUPS } from "./questions";

const all = GROUPS.flatMap((g) => g.qs);
const answer = (slug: string) => all.find((q) => q.slug === slug)!.a;

describe("S-FAQ-001 questions", () => {
  it("prints the design's price sentence from config/pricing.ts", () => {
    expect(answer("how-is-it-priced")).toContain("Basic is €249 a month, Standard €499, Advanced from €999, all excluding VAT.");
  });

  it("'an annual term is ten months for twelve' holds for every paid plan", () => {
    expect(answer("do-you-offer-a-discount")).toContain("ten months for twelve");
    for (const p of plans.filter((x) => x.billable)) expect(monthsFree(p.key as "basic"), p.key).toBe(2);
  });

  it("every group keeps at least one question, and slugs are unique", () => {
    for (const g of GROUPS) expect(g.qs.length, g.id).toBeGreaterThan(0);
    expect(new Set(all.map((q) => q.slug)).size).toBe(all.length);
  });
});
