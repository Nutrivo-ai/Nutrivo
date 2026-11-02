// D03 (T-402): what S-NV2-002's "3 · Which rulebook applies" shows for the product's latest app.classifications row.
// The model's suggestion carries label evidence only (worker nutrivo_worker.classification): per field the printed
// quote, its panel and language, or the reason the field was left empty. Nothing here invents a value or a citation:
// an empty field reads "Not determined" with the reason it was left for a person.

export const FIELDS = ["species", "life_stage", "product_class", "intended_use", "parnut_status"] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABEL: Record<Field, string> = {
  species: "Species",
  life_stage: "Life stage",
  product_class: "Product class",
  intended_use: "Intended use",
  parnut_status: "PARNUT status",
};

// Display names for the provisional vocabularies (question Q3 on #44); an unknown stored value is shown as stored.
const VALUE_LABEL: Record<string, string> = {
  dog: "Dog",
  cat: "Cat",
  growth: "Growth",
  adult: "Adult",
  senior: "Senior",
  complete: "Complete feed",
  complementary: "Complementary feed",
  treat: "Treat",
  mineral: "Mineral feed",
  dietetic: "Dietetic feed",
  other: "Other",
  parnut: "Particular nutritional purpose",
};

const EMPTY_REASON: Record<string, string> = {
  abstained: "Left for you: the label text does not show it",
  low_confidence: "Left for you: the suggestion was not sure enough",
  no_evidence: "Left for you: no printed words support it",
  quote_not_on_label: "Left for you: the quoted words are not on the label",
  value_not_allowed: "Left for you: not one of the recorded values",
  no_label_text: "Left for you: no readable label text",
};

export type ClassificationRow = {
  id: string;
  species: string | null;
  life_stage: string | null;
  product_class: string | null;
  intended_use: string | null;
  parnut_status: string | null;
  citation: string;
  provenance: string;
  confirmed_at: string | null;
  created_at: string;
};

type FieldCite = { quote?: string; panel_index?: number; language?: string | null };
type Citation = { basis?: string; fields?: Partial<Record<Field, FieldCite>>; empty?: Partial<Record<Field, string>> };

export type FieldView = { field: Field; label: string; value: string | null; cite: string; source: string };

export type ClassificationView = {
  id: string;
  confirmed: boolean;
  status: string;
  fields: FieldView[];
};

function parseCitation(text: string): Citation | null {
  try {
    const c = JSON.parse(text) as unknown;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Citation) : null;
  } catch {
    return null;
  }
}

export function valueLabel(value: string | null): string | null {
  return value === null ? null : (VALUE_LABEL[value] ?? value);
}

function quoteLine(c: FieldCite): string {
  const where = [c.panel_index !== undefined ? `panel ${c.panel_index + 1}` : null, c.language ? c.language.toUpperCase() : null]
    .filter(Boolean)
    .join(" · ");
  return `“${c.quote}”${where ? ` · ${where}` : ""}`;
}

/** One line per field: value or "Not determined", its citation (or why it is empty) and where it came from. */
export function describe(row: ClassificationRow): ClassificationView {
  const confirmed = row.confirmed_at !== null;
  const citation = parseCitation(row.citation);
  const fields = FIELDS.map((field): FieldView => {
    const value = valueLabel(row[field]);
    const cite = citation?.fields?.[field];
    let line: string;
    if (value !== null && cite?.quote) line = `Label text ${quoteLine(cite)}`;
    else if (value !== null) line = confirmed ? "Confirmed by a person" : "No citation recorded";
    else line = EMPTY_REASON[citation?.empty?.[field] ?? ""] ?? (confirmed ? "Not recorded" : "Left for you to fill");
    const source = value === null ? "—" : confirmed ? (cite?.quote && row.provenance !== "person" ? "Confirmed judgement" : "Person") : "Judgement";
    return { field, label: FIELD_LABEL[field], value, cite: line, source };
  });
  const filled = fields.filter((f) => f.value !== null).length;
  const status = confirmed
    ? `Confirmed ${row.confirmed_at!.slice(0, 10)}`
    : `Suggested from the label · ${filled} of ${FIELDS.length} filled · not confirmed`;
  return { id: row.id, confirmed, status, fields };
}
