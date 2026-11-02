import { describe, expect, it } from "vitest";
import { cleanValues, VOCABULARY } from "./vocabulary";

describe("classification vocabulary (provisional, Q3 on #44)", () => {
  it("[D03.fail.1] only recorded values reach the RPC; anything else stays empty, never guessed", () => {
    expect(cleanValues({ species: "cat", life_stage: "kitten", product_class: "complete", intended_use: "daily", parnut_status: 3 })).toEqual({
      species: "cat",
      life_stage: null,
      product_class: "complete",
      intended_use: null,
      parnut_status: null,
    });
  });

  it("mirrors app.confirm_classification's lists", () => {
    expect(VOCABULARY.species).toEqual(["dog", "cat"]);
    expect(VOCABULARY.intended_use).toEqual([]);
    expect(VOCABULARY.parnut_status).toEqual(["parnut"]);
  });
});
