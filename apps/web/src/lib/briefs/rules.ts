// T-1001 · E01 Create a brief (S-NV2-004): the formula and intended claims a person enters, as plain values. Pure, so
// the screen and its unit tests share one reading. The database decides what is valid (app.set_formula_lines,
// app.set_intended_claims); these only shape input and say what the screen shows.

/** One formula line as app.set_formula_lines takes it. The register row is the person's pick, never inferred. */
export type FormulaLineInput = {
  ingredient: string;
  percent: number | null;
  feed_material_ref: string | null;
  additive_ref: string | null;
  amount: number | null;
  unit: string | null;
};

/** A register row a line can name: a feed material (its catalogue number) or a feed additive (its identification). */
export type RegisterRow = { kind: "feed_material" | "additive"; ref: string; name: string };

export const MAX_LINES = 300;
export const MAX_CLAIMS = 50;

/** The statement under the formula heading (#76 Q4): what a formula does to a check, said before it is entered. */
export const FORMULA_CHANGES_OUTCOMES =
  "This formula changes check results. Additive rules are judged on these lines. With no formula, or with any line " +
  "not matched to the register, they are withheld, never passed. Saving a change makes the next check a new one.";

export const NOT_MATCHED_NOTE = "Not matched to the register: additive rules are withheld until it is.";

export function emptyLine(): FormulaLineInput {
  return { ingredient: "", percent: null, feed_material_ref: null, additive_ref: null, amount: null, unit: null };
}

export function isMatched(line: Pick<FormulaLineInput, "feed_material_ref" | "additive_ref">) {
  return Boolean(line.feed_material_ref || line.additive_ref);
}

/** "9 of 11 ingredients matched to the register". */
export function matchedSummary(lines: Pick<FormulaLineInput, "feed_material_ref" | "additive_ref">[]) {
  const n = lines.filter(isMatched).length;
  return `${n} of ${lines.length} ${lines.length === 1 ? "ingredient" : "ingredients"} matched to the register`;
}

/** The register match cell: "Feed material 9.1.1", "Additive 3b606" or "NO MATCH". */
export function registerLabel(line: Pick<FormulaLineInput, "feed_material_ref" | "additive_ref">) {
  if (line.feed_material_ref) return `Feed material ${line.feed_material_ref}`;
  if (line.additive_ref) return `Additive ${line.additive_ref}`;
  return "NO MATCH";
}

/** The % cell: the percent with one decimal, else the amount and its unit ("180 mg/kg"), else blank. */
export function quantityText(line: Pick<FormulaLineInput, "percent" | "amount" | "unit">) {
  if (line.percent !== null) return line.percent.toFixed(1);
  if (line.amount !== null) return `${formatNumber(line.amount)}${line.unit ? ` ${line.unit}` : ""}`;
  return "";
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** A number typed by a person: a comma decimal is read as a point; anything else is null. */
export function readNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * Pasted formula text, one ingredient per line, as copied from a spec sheet or spreadsheet. A trailing quantity is
 * read when it is unambiguous: "38.0", "38 %" or "38,0%" is a percent; "180 mg/kg" is an amount with its unit.
 * Columns split by a tab, semicolon or the last comma before a number. Nothing is matched to the register: the person
 * picks each row (#76 Q3), so every pasted line starts as NO MATCH.
 */
export function parsePaste(text: string): FormulaLineInput[] {
  const lines: FormulaLineInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    const cells = row.includes("\t") ? row.split("\t") : row.includes(";") ? row.split(";") : splitLastComma(row);
    const name = (cells[0] ?? "").trim().replace(/^[-•*\d.)\s]+(?=\D)/, "").trim();
    const q = parseQuantity(cells.slice(1).join(" "));
    const line = { ...emptyLine(), ingredient: name, ...(q ?? {}) };
    if (line.ingredient) lines.push(line);
  }
  return lines;
}

/**
 * The % cell as typed: "38.0", "38 %" or "38,0" is a percent (0 to 100); "180 mg/kg" an amount with its unit; blank
 * is no quantity. Anything else is null, so the screen says so rather than guessing.
 */
export function parseQuantity(text: string): Pick<FormulaLineInput, "percent" | "amount" | "unit"> | null {
  const t = text.trim();
  if (t === "") return { percent: null, amount: null, unit: null };
  const pct = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(t);
  if (pct) {
    const v = readNumber(pct[1]);
    return v !== null && v <= 100 ? { percent: v, amount: null, unit: null } : null;
  }
  const amt = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ]+(?:\/[a-zA-Z]+)?)$/.exec(t);
  if (amt) {
    const v = readNumber(amt[1]);
    return v === null ? null : { percent: null, amount: v, unit: amt[2] };
  }
  return null;
}

function splitLastComma(row: string) {
  const m = /^(.*\S)\s*,\s*(\d+(?:[.,]\d+)?\s*(?:%|[a-zA-Zµ/]+(?:\/[a-zA-Z]+)?)?)$/.exec(row);
  if (m) return [m[1], m[2]];
  // Split by a space only where the quantity says what it is ("0.6 %", "180 mg/kg"): a bare trailing number or code
  // may be part of the name ("Vitamin B 12", "Botanical blend 4B"), so it stays in the name rather than be guessed.
  const s = /^(.*\S)\s+(\d+(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?\s*[a-zA-Zµ]+\/[a-zA-Z]+)$/.exec(row);
  return s ? [s[1], s[2]] : [row];
}

/** The lines as the RPC takes them: blank lines dropped, text trimmed. Problems are the person's to fix first. */
export function formulaProblems(lines: FormulaLineInput[]): string[] {
  const problems: string[] = [];
  if (lines.length > MAX_LINES) problems.push(`A formula holds at most ${MAX_LINES} lines.`);
  lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.ingredient.trim()) problems.push(`Line ${n} needs the ingredient as entered.`);
    if (l.percent !== null && (l.percent < 0 || l.percent > 100)) problems.push(`Line ${n}: percent is between 0 and 100.`);
    if (l.amount !== null && !l.unit?.trim()) problems.push(`Line ${n}: an amount needs its unit.`);
  });
  return problems;
}

export function cleanLines(lines: FormulaLineInput[]): FormulaLineInput[] {
  return lines
    .filter((l) => l.ingredient.trim() !== "")
    .map((l) => ({
      ingredient: l.ingredient.trim(),
      percent: l.percent,
      feed_material_ref: l.feed_material_ref || null,
      additive_ref: l.additive_ref || null,
      amount: l.amount,
      unit: l.amount === null ? null : l.unit?.trim() || null,
    }));
}

/** Intended claims typed one per line, kept exactly as typed (trimmed): the customer's text, never generated. */
export function readClaims(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/** "EU · DE, AT, FR  ·  US · TX" from node ids such as EU-DE and US-TX; a region node alone reads as itself. */
export function targetNodes(nodes: string[]): string {
  const groups = new Map<string, string[]>();
  for (const id of nodes) {
    const [region, ...rest] = id.split("-");
    const list = groups.get(region) ?? [];
    if (rest.length) list.push(rest.join("-"));
    groups.set(region, list);
  }
  return [...groups.entries()].map(([r, l]) => (l.length ? `${r} · ${l.join(", ")}` : r)).join("  ·  ");
}
