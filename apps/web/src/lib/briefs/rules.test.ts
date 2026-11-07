// T-1001 · E01: the brief's pure rules. Pasted lines are read but never matched to the register (#76 Q3), and an
// unmatched line is said to withhold additive rules (Q2, Q4).
import { describe, expect, it } from "vitest";
import {
  FORMULA_CHANGES_OUTCOMES,
  cleanLines,
  emptyLine,
  formulaProblems,
  matchedSummary,
  parsePaste,
  parseQuantity,
  quantityText,
  readClaims,
  registerLabel,
  targetNodes,
} from "./rules";

describe("briefs rules", () => {
  it("[E01.main] reads a pasted formula: one line each, percent or amount, nothing matched to the register", () => {
    const lines = parsePaste("Chicken breast, cooked, 38.0\nChicken liver\t12,0 %\n\n- Zinc chelate of amino acids; 180 mg/kg\nBotanical blend 4B");
    expect(lines.map((l) => [l.ingredient, l.percent, l.amount, l.unit])).toEqual([
      ["Chicken breast, cooked", 38, null, null],
      ["Chicken liver", 12, null, null],
      ["Zinc chelate of amino acids", null, 180, "mg/kg"],
      ["Botanical blend 4B", null, null, null],
    ]);
    expect(lines.every((l) => l.feed_material_ref === null && l.additive_ref === null)).toBe(true);
  });

  it("splits on a space only where the quantity says what it is, never inside a name", () => {
    const lines = parsePaste("Zinc chelate 180 mg/kg\nGlucosamine HCl 0.8 %\nBotanical blend 4B\nVitamin B 12");
    expect(lines.map((l) => [l.ingredient, l.percent, l.amount, l.unit])).toEqual([
      ["Zinc chelate", null, 180, "mg/kg"],
      ["Glucosamine HCl", 0.8, null, null],
      ["Botanical blend 4B", null, null, null],
      ["Vitamin B 12", null, null, null],
    ]);
  });

  it("reads a quantity as a percent, an amount with its unit, blank, or nothing", () => {
    expect(parseQuantity("38.0")).toEqual({ percent: 38, amount: null, unit: null });
    expect(parseQuantity("0,6%")).toEqual({ percent: 0.6, amount: null, unit: null });
    expect(parseQuantity("180 mg/kg")).toEqual({ percent: null, amount: 180, unit: "mg/kg" });
    expect(parseQuantity("  ")).toEqual({ percent: null, amount: null, unit: null });
    expect(parseQuantity("120")).toBeNull();
    expect(parseQuantity("about ten")).toBeNull();
  });

  it("labels the register match and counts matched lines as the design does", () => {
    const fm = { ...emptyLine(), feed_material_ref: "9.1.1" };
    const add = { ...emptyLine(), additive_ref: "3b606" };
    expect([registerLabel(fm), registerLabel(add), registerLabel(emptyLine())]).toEqual(["Feed material 9.1.1", "Additive 3b606", "NO MATCH"]);
    expect(matchedSummary([fm, add, emptyLine()])).toBe("2 of 3 ingredients matched to the register");
    expect(quantityText({ percent: 38, amount: null, unit: null })).toBe("38.0");
    expect(quantityText({ percent: null, amount: 180, unit: "mg/kg" })).toBe("180 mg/kg");
  });

  it("[E01.main] says that the formula changes check results, and that without it additive rules are withheld", () => {
    expect(FORMULA_CHANGES_OUTCOMES).toMatch(/changes check results/);
    expect(FORMULA_CHANGES_OUTCOMES).toMatch(/withheld, never passed/);
  });

  it("finds problems before saving, and cleans lines for the RPC", () => {
    expect(formulaProblems([{ ...emptyLine(), ingredient: "x", amount: 5 }])).toEqual(["Line 1: an amount needs its unit."]);
    expect(formulaProblems([{ ...emptyLine(), ingredient: " " }])).toEqual(["Line 1 needs the ingredient as entered."]);
    expect(cleanLines([{ ...emptyLine(), ingredient: "  Liver ", unit: "g" }, emptyLine()])).toEqual([
      { ingredient: "Liver", percent: null, feed_material_ref: null, additive_ref: null, amount: null, unit: null },
    ]);
  });

  it("keeps intended claims as typed, one per line, and groups target nodes by region", () => {
    expect(readClaims("  Unterstützt die Gelenke \n\nFür ältere Hunde")).toEqual(["Unterstützt die Gelenke", "Für ältere Hunde"]);
    expect(targetNodes(["EU-AT", "EU-DE", "US-TX"])).toBe("EU · AT, DE  ·  US · TX");
    expect(targetNodes(["UK"])).toBe("UK");
  });
});
