// S-NV2-002 "3 · Which rulebook applies" (D03): every state renders, an empty field is never filled in, and the panel
// draws no control while the confirmation write path is open (Q1 on #44), so nothing in it is dead.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClassificationRow } from "@/lib/classification/describe";
import { ClassificationPanel } from "./ClassificationPanel";

const row: ClassificationRow = {
  id: "c-1",
  species: "cat",
  life_stage: null,
  product_class: "complete",
  intended_use: null,
  parnut_status: null,
  provenance: "model_judgement",
  confirmed_at: null,
  created_at: "2026-11-02T10:00:00Z",
  citation: JSON.stringify({
    fields: {
      species: { quote: "Complete feed for adult cats", panel_index: 0, language: "en" },
      product_class: { quote: "Complete feed for adult cats", panel_index: 0, language: "en" },
    },
    empty: { life_stage: "low_confidence", intended_use: "abstained", parnut_status: "abstained" },
  }),
};

describe("ClassificationPanel", () => {
  it("[D03.main] the loaded state lists the five values with their label evidence, unconfirmed", () => {
    const html = renderToStaticMarkup(<ClassificationPanel state={{ kind: "loaded", row }} />);
    expect(html).toContain("3 · Which rulebook applies");
    expect(html).toContain("Classification, determined before any check runs");
    for (const label of ["Species", "Life stage", "Product class", "Intended use", "PARNUT status"]) expect(html).toContain(label);
    expect(html).toContain("Complete feed");
    expect(html).toContain("Label text “Complete feed for adult cats” · panel 1 · EN");
    expect(html).toContain('data-confirmed="false"');
    expect(html).toContain("A person confirms these values before any rule uses them.");
  });

  it("[D03.fail.1] an unsure field reads Not determined with why it was left empty", () => {
    const html = renderToStaticMarkup(<ClassificationPanel state={{ kind: "loaded", row }} />);
    expect(html.match(/Not determined/g)).toHaveLength(3);
    expect(html).toContain("Left for you: the suggestion was not sure enough");
  });

  it.each([
    [{ kind: "loading" } as const, "READING THE LABEL"],
    [{ kind: "empty" } as const, "No classification yet."],
    [{ kind: "error" } as const, "The classification could not be read."],
  ])("renders the %o state", (state, text) => {
    const html = renderToStaticMarkup(<ClassificationPanel state={state} />);
    expect(html).toContain(text);
    expect(html).toContain("3 · Which rulebook applies");
  });

  it("draws no control until the confirmation write path exists", () => {
    for (const state of [{ kind: "loaded", row } as const, { kind: "empty" } as const, { kind: "error" } as const]) {
      const html = renderToStaticMarkup(<ClassificationPanel state={state} />);
      expect(html).not.toMatch(/<button|<a |<input|<select/);
    }
  });
});
