import { describe, expect, it } from "vitest";
import {
  allowanceMoment,
  checkProduct,
  counterText,
  marketGroups,
  marketLine,
  productRefusal,
  provisionalName,
  type ProductInput,
} from "./rules";

const ws = "11111111-1111-4111-8111-111111111111";

describe("productRefusal (T-401)", () => {
  it("[C01.fail.1] over the cap: the next plan is offered, nothing is created and the invoice does not grow", () => {
    const r = productRefusal("P0034", ws, JSON.stringify({ plan: "basic", recipes_included: 10, next_plan: "standard" }));
    expect(r.title).toBe("Every recipe on your plan is in use");
    expect(r.body).toContain("All 10 recipes your plan includes are live, so a new recipe needs Standard");
    expect(r.body).toContain("Nothing was created and nothing was added to your invoice");
    expect(r.offer).toEqual({ label: "See Standard", href: `/w/${ws}/billing/plans` });
  });

  it("[C01.must.2] the offer climbs Basic → Standard → Advanced, and still offers plans without a hint", () => {
    expect(productRefusal("P0034", ws, JSON.stringify({ plan: "standard" })).offer?.label).toBe("See Advanced");
    expect(productRefusal("P0034", ws, "not json").offer?.label).toBe("See plans");
  });

  it("[B02.fail.1] allowance used: P0032 with the upsell, and says what stays", () => {
    const r = productRefusal("P0032", ws);
    expect(r.body).toContain("Everything already checked stays readable and re-checking it stays free");
    expect(r.offer?.href).toBe(`/w/${ws}/billing/plans`);
  });

  it("names permission and unknown failures without blaming the person", () => {
    expect(productRefusal("42501", ws).title).toMatch(/role/);
    expect(productRefusal(undefined, ws).code).toBe("unknown");
  });
});

describe("checkProduct (C01)", () => {
  const ok: ProductInput = { name: "Salmon & Rice Adult 12 kg", familyId: null, familyName: "", stage: "in_development", species: "dog", lifeStage: "adult", format: "dry", nodes: ["EU-DE"] };
  it("[C01.main] accepts a product with a stage", () => expect(checkProduct(ok)).toBeNull());
  it("needs a name of 1 to 200 characters", () => {
    expect(checkProduct({ ...ok, name: "  " })).toBe("name");
    expect(checkProduct({ ...ok, name: "x".repeat(201) })).toBe("name");
  });
  it("never creates a product discontinued", () => expect(checkProduct({ ...ok, stage: "discontinued" })).toBe("stage"));
});

describe("provisionalName (C02)", () => {
  it("[C02.main] names the product from the file, as the database does", () => {
    expect(provisionalName("Puppy_Wet  Chicken.pdf")).toBe("Puppy Wet Chicken");
    expect(provisionalName(".pdf")).toBe("Untitled label");
  });
});

describe("allowanceMoment (B02, S-PLN-004, S-PLN-005)", () => {
  it("[B02.main] nothing on the first label; the header counts from the second; one panel when one is left", () => {
    expect(allowanceMoment({ plan: "free", used: 0, allowed: 3 }, false)).toEqual({ kind: "none" });
    const one = allowanceMoment({ plan: "free", used: 1, allowed: 3 }, true);
    expect(one.kind).toBe("counter");
    expect(counterText(one)).toBe("2 of 3 free labels left");
    const two = allowanceMoment({ plan: "free", used: 2, allowed: 3 }, true);
    expect(two.kind).toBe("last");
    expect(counterText(two)).toBe("1 of 3 free labels left");
  });

  it("[B02.fail.1] all used: a product without artwork gets the fourth-label card, a checked one keeps re-checking", () => {
    expect(allowanceMoment({ plan: "free", used: 3, allowed: 3 }, false)).toEqual({ kind: "spent", used: 3, allowed: 3, hasArtwork: false });
    expect(allowanceMoment({ plan: "free", used: 3, allowed: 3 }, true)).toMatchObject({ kind: "spent", hasArtwork: true });
    expect(counterText(allowanceMoment({ plan: "free", used: 3, allowed: 3 }, true))).toBe("3 of 3 free labels used");
  });

  it("[B02.must.2] a paid workspace never sees the free allowance", () => {
    expect(allowanceMoment({ plan: "basic", used: 3, allowed: 3 }, false)).toEqual({ kind: "none" });
  });
});

describe("markets (C01 step 3)", () => {
  const nodes = [
    { id: "EU", name: "European Union", node_type: "region", parent_id: null },
    { id: "EU-FR", name: "France", node_type: "country", parent_id: "EU" },
    { id: "EU-DE", name: "Germany", node_type: "country", parent_id: "EU" },
    { id: "US-TX", name: "Texas", node_type: "state", parent_id: "US" },
  ];
  it("offers only the entitled regions' markets, never a region itself", () => {
    expect(marketGroups(nodes, ["EU"])).toEqual([{ region: "EU", nodes: [nodes[2], nodes[1]] }]);
  });
  it("writes the market list as the design does", () => expect(marketLine(["EU-FR", "EU-DE", "UK-GB"])).toBe("EU · DE, FR · UK · GB"));
});
