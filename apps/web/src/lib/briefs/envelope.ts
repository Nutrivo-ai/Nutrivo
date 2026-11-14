// T-1002 · E02 the compliance envelope, shaped for Design envelope (S-NV2-005). Pure functions over the rows that
// queries.ts reads under RLS (app.envelopes, app.envelope_nodes, app.envelope_items): no verdict is computed here.
// A market's state is the database's (private.envelope_verdict_guard refuses Clear unless it is fully encoded and
// nothing for it was withheld); an item is shown exactly as written, with its rule or its gap.
import type { Provenance, VerdictState } from "@/components/kit";

export type EnvelopeState = Extract<VerdictState, "clear" | "action" | "not_assessed">;
export type ItemKind = "requirement" | "permitted" | "prohibited" | "limit" | "obligation" | "not_assessed";

export type EnvelopeItemRow = {
  id: string;
  node_id: string | null;
  language: string | null;
  kind: string;
  rule_key: string | null;
  rule_version: number | null;
  gap_id: string | null;
  provenance: string;
  reason_code: string | null;
  citation: string | null;
  payload: unknown;
};

export type EnvelopeNodeRow = { node_id: string; state: string; open_items: number; withheld: number };

export type Measure = { value: number; unit: string };

/** One additive line of the brief with its limit per market (the envelope table). */
export type LimitRow = {
  key: string;
  name: string;
  reg: string;
  used: string;
  cells: Record<string, { text: string; state: EnvelopeState }>;
};

export type WordingRow = {
  key: string;
  language: string;
  kind: "requirement" | "permitted" | "obligation" | "prohibited";
  title: string;
  text: string;
  markets: string[];
  ruleKey: string;
  citation: string;
  provenance: Provenance;
};

export type WithheldRow = {
  key: string;
  nodeId: string;
  language: string | null;
  what: string;
  reason: string;
  ruleKey: string | null;
  citation: string | null;
  gapId: string | null;
};

export type EnvelopeView = {
  markets: { nodeId: string; state: EnvelopeState }[];
  limits: LimitRow[];
  wording: WordingRow[];
  withheld: WithheldRow[];
  outOfScope: string[];
};

const STATES: readonly string[] = ["clear", "action", "not_assessed"];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function measure(v: unknown): Measure | null {
  const m = obj(v);
  return typeof m.value === "number" && typeof m.unit === "string" && m.unit ? { value: m.value, unit: m.unit } : null;
}

const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 3 });

/** "EU-DE" → "DE": the market as the design's column heads print it. */
export const marketLabel = (nodeId: string) => nodeId.replace(/^[A-Z]+-/, "");

/** What the reason code means, in the words of the not-assessed list. */
export const REASON_TEXT: Record<string, string> = {
  not_encoded: "Not encoded for this market yet",
  partially_encoded: "Only partly encoded for this market",
  data_missing: "Needs data the brief or the term register does not give",
  claim_not_evaluated: "Claims are not evaluated yet",
  evaluator_missing: "No reading for this kind of rule yet",
  evaluator_error: "Could not be read; reported",
  out_of_scope: "Out of scope",
};

export const DOMAIN_TEXT: Record<string, string> = {
  mandatory_particulars: "Mandatory particulars",
  composition: "Composition",
  claims_wording: "Claims and wording",
  type_geometry: "Type and geometry",
  language: "Language",
  registration: "Registration",
};

export function buildEnvelope(nodes: EnvelopeNodeRow[], items: EnvelopeItemRow[], outOfScope: string[]): EnvelopeView {
  const markets = nodes
    .map((n) => ({ nodeId: n.node_id, state: (STATES.includes(n.state) ? n.state : "not_assessed") as EnvelopeState }))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  // Limits: one row per additive the brief names, a cell per market. Anything withheld for that additive is N/A.
  const limits = new Map<string, LimitRow>();
  const limitRow = (p: Record<string, unknown>) => {
    const ref = str(p.additive_ref) ?? "?";
    let row = limits.get(ref);
    if (!row) {
      const amount = typeof p.amount === "number" ? p.amount : null;
      row = {
        key: ref,
        name: str(p.ingredient) ?? ref,
        reg: `Additive ${ref}`,
        used: amount !== null && str(p.unit) ? `${fmt(amount)} ${p.unit}` : "—",
        cells: {},
      };
      limits.set(ref, row);
    }
    return row;
  };
  for (const i of items) {
    const p = obj(i.payload);
    if (!i.node_id || !str(p.additive_ref)) continue;
    if (i.kind === "limit") {
      const max = measure(p.max_content);
      const row = limitRow(p);
      if (row.cells[i.node_id]?.state === "not_assessed") continue;
      row.cells[i.node_id] = {
        text: max ? `${fmt(max.value)} max` : "—",
        state: p.outcome === "exceeds" ? "action" : row.cells[i.node_id]?.state === "action" ? "action" : "clear",
      };
    } else if (i.kind === "not_assessed" && p.check === "within_max_content") {
      limitRow(p).cells[i.node_id] = { text: "N/A", state: "not_assessed" };
    }
  }

  // Wording: one row per (language, rule, kind), with the markets it holds for. Only the register's own wording.
  const wording = new Map<string, WordingRow>();
  for (const i of items) {
    if (!i.node_id || !i.rule_key) continue;
    const p = obj(i.payload);
    if (i.kind === "requirement" || i.kind === "permitted" || i.kind === "obligation") {
      const words = strings(p.wordings);
      if (!i.language || words.length === 0) continue;
      const key = `${i.language}|${i.rule_key}|${i.kind}`;
      const row = wording.get(key) ?? {
        key,
        language: i.language,
        kind: i.kind,
        title: str(p.title) ?? i.rule_key,
        text: words.join(" · "),
        markets: [],
        ruleKey: i.rule_key,
        citation: i.citation ?? i.rule_key,
        provenance: "deterministic_rule" as Provenance,
      };
      if (!row.markets.includes(i.node_id)) row.markets.push(i.node_id);
      wording.set(key, row);
    } else if (i.kind === "prohibited") {
      const key = `-|${i.rule_key}|${str(p.additive_ref)}|prohibited`;
      const row = wording.get(key) ?? {
        key,
        language: "—",
        kind: "prohibited" as const,
        title: str(p.title) ?? i.rule_key,
        text: `${str(p.ingredient) ?? str(p.additive_ref) ?? "This additive"}: not authorised for this product as briefed.`,
        markets: [],
        ruleKey: i.rule_key,
        citation: i.citation ?? i.rule_key,
        provenance: "deterministic_rule" as Provenance,
      };
      if (!row.markets.includes(i.node_id)) row.markets.push(i.node_id);
      wording.set(key, row);
    }
  }

  const withheld: WithheldRow[] = items
    .filter((i) => i.kind === "not_assessed" && i.node_id)
    .map((i) => {
      const p = obj(i.payload);
      const domain = str(p.domain);
      const what = i.gap_id
        ? `${DOMAIN_TEXT[domain ?? ""] ?? domain ?? "This domain"}`
        : [str(p.title) ?? i.rule_key, str(p.additive_ref) ? `(${p.ingredient ?? p.additive_ref})` : null].filter(Boolean).join(" ");
      return {
        key: i.id,
        nodeId: i.node_id as string,
        language: i.language,
        what: what || "—",
        reason: REASON_TEXT[i.reason_code ?? ""] ?? i.reason_code ?? "Not assessed",
        ruleKey: i.rule_key,
        citation: i.citation,
        gapId: i.gap_id,
      };
    })
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId) || Number(Boolean(b.gapId)) - Number(Boolean(a.gapId)) || a.what.localeCompare(b.what));

  return {
    markets,
    limits: [...limits.values()].sort((a, b) => a.name.localeCompare(b.name)),
    wording: [...wording.values()].sort((a, b) => a.language.localeCompare(b.language) || a.title.localeCompare(b.title)),
    withheld,
    outOfScope,
  };
}

/** Markets with nothing answered and no item at all: not_assessed, with no gap to name (issue 179, DB-1). */
export function unexplained(view: EnvelopeView): string[] {
  const named = new Set(view.withheld.map((w) => w.nodeId));
  return view.markets.filter((m) => m.state === "not_assessed" && !named.has(m.nodeId)).map((m) => m.nodeId);
}
