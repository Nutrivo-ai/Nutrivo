import { describe as suite, expect, it } from "vitest";
import { describe, type ClassificationRow } from "./describe";

const suggestion: ClassificationRow = {
  id: "c-1",
  species: "cat",
  life_stage: "adult",
  product_class: null,
  intended_use: null,
  parnut_status: null,
  provenance: "model_judgement",
  confirmed_at: null,
  created_at: "2026-11-02T10:00:00Z",
  citation: JSON.stringify({
    basis: "label_text",
    fields: {
      species: { quote: "Complete feed for adult cats", panel_index: 0, language: "en", confidence: 0.99 },
      life_stage: { quote: "Alleinfuttermittel für ausgewachsene Katzen", panel_index: 2, language: "de", confidence: 0.9 },
    },
    empty: { product_class: "low_confidence", intended_use: "abstained", parnut_status: "abstained" },
  }),
};

suite("classification view (S-NV2-002, D03)", () => {
  it("[D03.main] shows each suggested value with the printed words it rests on, in their own language", () => {
    const v = describe(suggestion);
    expect(v.confirmed).toBe(false);
    expect(v.status).toBe("Suggested from the label · 2 of 5 filled · not confirmed");
    expect(v.fields[0]).toEqual({
      field: "species",
      label: "Species",
      value: "Cat",
      cite: "Label text “Complete feed for adult cats” · panel 1 · EN",
      source: "Judgement",
    });
    expect(v.fields[1].cite).toBe("Label text “Alleinfuttermittel für ausgewachsene Katzen” · panel 3 · DE");
  });

  it("[D03.fail.1] an unsure field reads Not determined with the reason, never a guess", () => {
    const v = describe(suggestion);
    const pc = v.fields.find((f) => f.field === "product_class")!;
    expect(pc.value).toBeNull();
    expect(pc.cite).toBe("Left for you: the suggestion was not sure enough");
    expect(pc.source).toBe("—");
    expect(v.fields.find((f) => f.field === "intended_use")!.cite).toBe("Left for you: the label text does not show it");
  });

  it("a citation that is not the worker's JSON is never parsed into evidence", () => {
    const v = describe({ ...suggestion, citation: "test" });
    expect(v.fields[0].cite).toBe("No citation recorded");
    expect(v.fields[2].cite).toBe("Left for you to fill");
  });

  it("a person's confirmed row reads as confirmed", () => {
    const v = describe({ ...suggestion, provenance: "person", confirmed_at: "2026-11-03T08:00:00Z", citation: "confirmed" });
    expect(v.confirmed).toBe(true);
    expect(v.status).toBe("Confirmed 2026-11-03");
    expect(v.fields[0]).toMatchObject({ value: "Cat", cite: "Confirmed by a person", source: "Person" });
  });
});
