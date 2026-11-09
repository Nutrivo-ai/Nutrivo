// S-NV2-004 Brief & formula (T-1001, E01): the brief fields, the formula with its register matches and the
// formula-changes-outcomes statement, the empty state when no formula is entered, and the intended claims per language.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Brief } from "@/lib/briefs/queries";
import { BriefForm } from "./BriefForm";

vi.mock("@/lib/briefs/actions", () => ({
  saveFormula: async () => ({ ok: true, count: 0 }),
  saveClaims: async () => ({ ok: true, count: 0 }),
  findInRegister: async () => ({ ok: true, rows: [] }),
  promoteBrief: async () => ({ ok: false, reason: "error" }),
}));

const WS = "20000000-0000-4000-8101-00000000000a";
const brief: Brief = {
  id: "40000000-0000-4000-8101-00000000000a",
  name: "Senior Joint Support Wet",
  stage: "brief",
  species: "dog",
  lifeStage: "Senior (7+)",
  productClass: "complementary",
  nodes: ["EU-AT", "EU-DE", "US-TX"],
  lines: [
    { id: "l1", ingredient: "Chicken liver", percent: 12, feed_material_ref: "9.3.1", additive_ref: null, amount: null, unit: null, registerName: "Liver" },
    { id: "l2", ingredient: "Botanical blend 4B", percent: 0.6, feed_material_ref: null, additive_ref: null, amount: null, unit: null, registerName: null },
    { id: "l3", ingredient: "Zinc chelate", percent: null, feed_material_ref: null, additive_ref: "3b606", amount: 180, unit: "mg/kg", registerName: null },
  ],
  claims: { de: ["Unterstützt die Gelenkbeweglichkeit"] },
  languages: ["de", "en", "fr"],
};

describe("BriefForm", () => {
  it("[E01.main] the loaded brief shows its fields, its formula with register matches, and its claims", () => {
    const html = renderToStaticMarkup(<BriefForm workspaceId={WS} brief={brief} />);
    for (const label of ["The brief", "Working name", "Species", "Life stage", "Product class", "Target nodes", "Intended claim"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Complementary feed");
    expect(html).toContain("EU · AT, DE  ·  US · TX");
    expect(html).toContain("2 of 3 ingredients matched to the register");
    expect(html).toContain("Feed material 9.3.1");
    expect(html).toContain("Additive 3b606");
    expect(html).toContain("NO MATCH");
    expect(html).toContain("180 mg/kg");
    expect(html).toContain("Unterstützt die Gelenkbeweglichkeit");
  });

  it("[E01.main] states under the formula heading that the formula changes check results", () => {
    const html = renderToStaticMarkup(<BriefForm workspaceId={WS} brief={brief} />);
    expect(html).toMatch(/data-formula-changes-outcomes[^>]*>This formula changes check results/);
  });

  it("notes only the lines not matched to the register (#76 Q2), and offers Paste only (Q5)", () => {
    const html = renderToStaticMarkup(<BriefForm workspaceId={WS} brief={brief} />);
    expect(html.match(/Not matched to the register/g)).toHaveLength(1);
    expect(html).toContain(">Paste<");
    // ">Upload<" is the formula's Upload control; T-1003's promote note names the Upload & scope screen.
    for (const absent of [">Upload<", "Import from spec", "Screen this brief", "What we can answer with this"]) {
      expect(html).not.toContain(absent);
    }
  });

  it("the empty state says that with no formula additive rules are withheld, and offers one way in", () => {
    const html = renderToStaticMarkup(<BriefForm workspaceId={WS} brief={{ ...brief, lines: [], claims: {}, productClass: null }} />);
    expect(html).toContain("No formula has been entered");
    expect(html).toContain("withheld as missing data, never passed");
    expect(html).toContain("Add a line");
    expect(html).toContain("Not determined");
    expect(html).toContain("No intended claims yet.");
    expect(html).not.toContain("Save formula");
  });
});
