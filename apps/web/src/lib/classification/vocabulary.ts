// The provisional closed vocabularies a person may confirm (docs/03; Q3 on #44, revisited at T-208). They mirror
// app.confirm_classification, which refuses anything else (22023). Intended use has no recorded values yet.
import type { Field } from "./describe";

export const VOCABULARY: Record<Field, readonly string[]> = {
  species: ["dog", "cat"],
  life_stage: ["growth", "adult", "senior"],
  product_class: ["complete", "complementary", "treat", "mineral", "dietetic", "other"],
  intended_use: [],
  parnut_status: ["parnut"], // only ever positive: no value says "not PARNUT" (Q3 on #44)
};

export type ConfirmValues = Record<Field, string | null>;

/** Only values from the vocabulary reach the RPC; anything else is null (left for a person, never guessed). */
export function cleanValues(input: Partial<Record<Field, unknown>>): ConfirmValues {
  const out = {} as ConfirmValues;
  for (const f of Object.keys(VOCABULARY) as Field[]) {
    const v = input[f];
    out[f] = typeof v === "string" && VOCABULARY[f].includes(v) ? v : null;
  }
  return out;
}
