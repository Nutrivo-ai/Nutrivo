import { describe, expect, it } from "vitest";
import { plans } from "../../../../../config/pricing";
import { annualSaving, annualSavingPercent, extrasFor, fitFor, netPrice, nextPlan, readCounts, recommended, REGION_ADDON_ON_SALE, type LiveCounts } from "./plans";

const counts = (c: Partial<LiveCounts>): LiveCounts => ({ recipes: 0, regions: ["EU"], editorSeats: 1, labelsUsed: 0, labelsAllowed: 3, ...c });

describe("billing plans (T-703)", () => {
  it("[M02.main] the plan picker recommends the smallest plan whose list price plus capped overage covers the counts", () => {
    expect(recommended(counts({ recipes: 8, editorSeats: 3 }))).toBe("basic");
    // Over Basic's ten recipes or three editors, but under its €374 ceiling: still Basic, with add-ons.
    expect(recommended(counts({ recipes: 11, editorSeats: 2 }))).toBe("basic"); // €249 + €15
    expect(recommended(counts({ recipes: 8, editorSeats: 4 }))).toBe("basic"); // €249 + €50
    expect(recommended(counts({ recipes: 18, editorSeats: 1 }))).toBe("basic"); // €249 + 8 × €15 = €369
    // Past the ceiling the next plan is offered instead.
    expect(recommended(counts({ recipes: 19, editorSeats: 1 }))).toBe("standard"); // €384 > €374
    expect(recommended(counts({ recipes: 8, editorSeats: 6 }))).toBe("standard"); // €249 + 3 × €50 = €399
    expect(recommended(counts({ recipes: 50, editorSeats: 2 }))).toBe("standard"); // €499 + 20 × €12 = €739
    expect(recommended(counts({ recipes: 51, editorSeats: 2 }))).toBe("advanced"); // €751 > €749
    expect(recommended(counts({ recipes: 0, editorSeats: 1 }))).toBe("basic");
    expect(extrasFor("basic", counts({ recipes: 12, editorSeats: 4 }))).toEqual({ recipes: 2, editorSeats: 1 });
  });

  it("[M02.main] past 1.5x list the next plan is offered instead (BE-34)", () => {
    // Basic €249: recipes 11+ are €15 each, the bill stops at €374 (8 extra = €369 fits, 9 extra = €384 does not).
    expect(fitFor("basic", counts({ recipes: 18 })).fits).toBe(true);
    expect(fitFor("basic", counts({ recipes: 18 })).monthly).toBe(249_00 + 8 * 15_00);
    expect(fitFor("basic", counts({ recipes: 19 })).pastCap).toBe(true);
    expect(fitFor("basic", counts({ recipes: 19 })).fits).toBe(false);
    // Standard €499: recipes 31+ are €12 each, the bill stops at €749.
    expect(fitFor("standard", counts({ recipes: 50 })).fits).toBe(true);
    expect(fitFor("standard", counts({ recipes: 51 })).pastCap).toBe(true);
    expect(nextPlan("basic")).toBe("standard");
    expect(nextPlan("standard")).toBe("advanced");
    // Advanced has no recipe or seat limit.
    expect(fitFor("advanced", counts({ recipes: 400, editorSeats: 90 })).holds).toBe(true);
  });

  it("[M02.main] the region add-on is not for sale while only the EU exists (D-03, 3 Nov 2026)", () => {
    expect(REGION_ADDON_ON_SALE).toBe(false);
    expect(fitFor("standard", counts({ regions: ["EU"] })).regionsFit).toBe(true);
    expect(fitFor("standard", counts({ regions: ["EU", "UK"] })).regionsFit).toBe(false);
    expect(fitFor("advanced", counts({ regions: ["EU", "UK"] })).regionsFit).toBe(true);
  });

  it("[M02.must.1] counts come from the live RPC's own answer, nothing remembered between calls", () => {
    expect(readCounts({ recipes: 8, regions: ["EU"], editor_seats: 3, labels_used: 2, labels_allowed: 3 })).toEqual({
      recipes: 8, regions: ["EU"], editorSeats: 3, labelsUsed: 2, labelsAllowed: 3,
    });
    expect(readCounts({ recipes: 9, regions: [], editor_seats: 4, labels_used: 3, labels_allowed: 3 })?.recipes).toBe(9);
    // A non-member gets null from app.live_billable_counts: no counts, never a guess.
    expect(readCounts(null)).toBeNull();
  });

  it("[M01.must.1] prices are net, straight from config/pricing.ts, and the annual saving is two months", () => {
    for (const p of plans.filter((x) => x.billable)) {
      const key = p.key as "basic" | "standard" | "advanced";
      expect(netPrice(key, "monthly")).toBe(p.prices.find((x) => x.interval === "month")!.amount);
      expect(netPrice(key, "annual")).toBe(p.prices.find((x) => x.interval === "year")!.amount);
    }
    expect(annualSaving("standard")).toBe(998_00);
    expect(annualSavingPercent("standard")).toBe("16.7%");
  });
});
