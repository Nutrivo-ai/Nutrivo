import { describe, expect, it } from "vitest";
import { buildPlan, inPlan, regionName, regionOf } from "./regions";

const places = [
  { id: "EU", name: "European Union", parent_id: null },
  { id: "EU-FR", name: "France", parent_id: "EU" },
  { id: "US", name: "United States", parent_id: null },
  { id: "US-TX", name: "Texas", parent_id: "US" },
];

describe("the plan's regions (T-902)", () => {
  it("[J04.must.1] a market is in the plan only when its region is one the workspace holds", () => {
    const plan = buildPlan(["EU"], places);
    expect(inPlan(plan, "EU-FR")).toBe(true);
    expect(inPlan(plan, "EU")).toBe(true);
    expect(inPlan(plan, "US-TX")).toBe(false);
    expect(inPlan(plan, "US")).toBe(false);
    expect(regionOf(plan, "US-TX")).toBe("US");
    expect(regionName(plan, "US-TX")).toBe("United States");
    expect(inPlan(buildPlan(["EU", "US"], places), "US-TX")).toBe(true);
  });

  it("an unknown market is its own region, in no plan that does not name it", () => {
    const plan = buildPlan(["EU"], places);
    expect(inPlan(plan, "XX-YY")).toBe(false);
    expect(regionName(plan, "XX-YY")).toBe("XX-YY");
    expect(inPlan(buildPlan([], places), "EU-FR")).toBe(false);
  });
});
