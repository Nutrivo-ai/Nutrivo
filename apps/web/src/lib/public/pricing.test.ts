import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addonAmount, amount, euros, FREE_ARTWORKS, monthsFree, PARTNER, plans, priceLabel } from "./pricing";

const BILLING = fs.readFileSync(path.resolve(__dirname, "../../../../../docs/08-billing.md"), "utf8");

/** The "Plans and dials" table of docs/08-billing.md: plan name → its price cell. */
function billingTable(): Map<string, string> {
  const section = BILLING.split("## Plans and dials")[1].split("\n## ")[0];
  const rows = section.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Plan") && !l.startsWith("|---"));
  return new Map(rows.map((l) => l.split("|").map((c) => c.trim())).map((c) => [c[1].replace(/ \(after launch\)$/, ""), c[2]]));
}

describe("pricing, from config/pricing.ts", () => {
  it("[P02.must.1] plan names and monthly prices match docs/08-billing.md", () => {
    const table = billingTable();
    for (const p of plans) {
      expect(table.has(p.name), `${p.name} is a plan in docs/08`).toBe(true);
      expect(table.get(p.name)!.startsWith(priceLabel(p.key, "month")), `${p.name}: ${table.get(p.name)}`).toBe(true);
    }
    expect(table.get(PARTNER.name)).toBe(`${euros(PARTNER.monthly)} per ${PARTNER.clientWorkspaces} client workspaces`);
    expect(BILLING).toContain(`${["Zero", "One", "Two", "Three"][FREE_ARTWORKS]} new label artworks per workspace`);
  });

  it("formats whole euros as the designs print them", () => {
    expect(euros(249_00)).toBe("€249");
    expect(euros(2_490_00)).toBe("€2,490");
    expect(priceLabel("advanced", "month")).toBe("from €999");
    expect(priceLabel("free", "month")).toBe("€0");
    expect(amount("standard", "year")).toBe(4_990_00);
  });

  it("an annual term is ten months for twelve on every paid plan", () => {
    for (const key of ["basic", "standard", "advanced"] as const) expect(monthsFree(key)).toBe(2);
  });

  it("add-ons only where the plan may buy them", () => {
    expect(addonAmount("region", "standard", "month")).toBe(199_00);
    expect(addonAmount("region", "basic", "month")).toBeNull();
    expect(addonAmount("recipe", "basic", "month")).toBe(15_00);
    expect(addonAmount("recipe", "advanced", "month")).toBeNull();
  });
});
