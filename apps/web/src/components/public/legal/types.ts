// The shape of one legal document as the design file's <script> holds it (design/public/Nutrivo Legal - Terms, DPA,
// Privacy.dc.html): a header, four facts, numbered sections of clauses with an optional table, and a contact block.

export type Clause = { n: string; v: string };
export type Table = { head: string[]; rows: string[][] };
export type Section = { n: string; k: string; lead: string | null; clauses: Clause[]; table?: Table };

export type LegalDoc = {
  tab: string;
  kicker: string;
  title: string;
  intro: string;
  facts: { k: string; v: string }[];
  contactLine: string;
  version: string;
  sections: Section[];
};

/** The design's own helper, so the data modules read line for line against the design file. */
export const sec = (n: string, k: string, lead: string | null, clauses: Clause[], table?: Table): Section => ({ n, k, lead, clauses, table });
